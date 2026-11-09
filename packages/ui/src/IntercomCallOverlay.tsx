import { useState } from 'react';
import { Button } from './Button';
import { DemoVideo } from './DemoVideo';
import { declineCall, openFromCall, useActiveCall } from '@shared/useVideo';
import { useSipAudio } from '@shared/useSipAudio';
import styles from './IntercomCallOverlay.module.css';

/**
 * Входящий звонок в домофон.
 *
 * Появляется поверх любого экрана жителя: гость нажал кнопку на вызывной
 * панели — житель видит картинку и две кнопки. Искать раздел «Доступ»
 * в этот момент некогда.
 *
 * Опрос раз в 5 секунд — сознательный компромисс скелета. Когда звонки
 * станут реальными, здесь появится WebSocket или SSE: задержка в 5 секунд
 * для домофона многовато.
 */
export function IntercomCallOverlay() {
  const { call, refresh } = useActiveCall(2000);
  const sip = useSipAudio();
  const [busy, setBusy] = useState<'open' | 'decline' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  if (!call || dismissedId === call.id) return null;

  const handleOpen = async () => {
    setBusy('open');
    try {
      const result = await openFromCall(call.id);
      setMessage(result.message);
      if (!result.ok) {
        // Не закрываем окно: человек должен увидеть причину и попробовать снова
        setBusy(null);
        return;
      }
      // Дверь открыта — разговор больше не нужен, освобождаем микрофон.
      sip.hangup();
      window.setTimeout(() => {
        setDismissedId(call.id);
        setMessage(null);
        void refresh();
      }, 1200);
    } finally {
      setBusy(null);
    }
  };

  const handleDecline = async () => {
    setBusy('decline');
    try {
      sip.hangup();
      await declineCall(call.id);
      setDismissedId(call.id);
      setMessage(null);
      void refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Звонок в домофон">
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.pulse} aria-hidden="true" />
          <div>
            <p className={styles.title}>Звонок в домофон</p>
            <p className={styles.subtitle}>
              {call.pointName} · кв. {call.apartmentNumber}
            </p>
          </div>
        </div>

        {call.stream?.demo !== false ? (
          <DemoVideo label={call.cameraName ?? call.pointName} />
        ) : (
          /*
           * Живой поток показываем во встроенном плеере медиасервера.
           *
           * Почему не <video src>: обычный mp4-поток браузер начинает с
           * ближайшего ключевого кадра и держит буфер — на стенде это давало
           * 10–30 секунд чёрного экрана. Плеер go2rtc отдаёт поток через
           * WebSocket (MSE) с задержкой около секунды и сам выбирает рабочий
           * способ доставки.
           *
           * Разрешения iframe: autoplay — иначе картинка ждёт нажатия.
           */
          <div className={styles.streamWrap}>
            <iframe
              className={styles.stream}
              src={call.stream?.url ?? undefined}
              title={`Видео с ${call.pointName}`}
              allow="autoplay; fullscreen; picture-in-picture"
              referrerPolicy="no-referrer"
            />
          </div>
        )}

        {/*
         * Звук: отвечать нужно отдельной кнопкой.
         * Браузер спрашивает доступ к микрофону только по действию
         * пользователя — автоматически включить его нельзя.
         */}
        <audio ref={sip.audioRef} autoPlay playsInline hidden />

        {sip.incoming && (
          <div className={styles.answerRow}>
            <Button block loading={busy === null && sip.talking} onClick={sip.answer}>
              Ответить и говорить
            </Button>
          </div>
        )}

        {sip.talking && <p className={styles.soundOn}>Звук включён — вас слышно</p>}

        {sip.error && <p className={styles.message}>{sip.error}</p>}

        {message && <p className={styles.message}>{message}</p>}

        <div className={styles.actions}>
          <Button block loading={busy === 'open'} onClick={() => void handleOpen()}>
            Открыть
          </Button>
          <Button variant="ghost" block disabled={busy !== null} onClick={() => void handleDecline()}>
            Отклонить
          </Button>
        </div>

        {call.stream?.demo !== false && (
          <p className={styles.note}>
            Демонстрационный звонок: картинка с камеры не подключена, дверь физически не
            открывается.
          </p>
        )}
      </div>
    </div>
  );
}
