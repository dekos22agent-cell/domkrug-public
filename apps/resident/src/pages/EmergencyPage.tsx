import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@ui/Button';
import { CenteredSpinner } from '@ui/Spinner';
import {
  cancelEmergencyCall,
  createEmergencyCall,
  useContacts,
  useEmergencyCalls,
} from '@shared/useUtilities';
import { formatDateTime, formatRelative } from '@shared/format';
import type { EmergencyCall } from '@shared/types';
import styles from './utilities.module.css';
import pageStyles from './pages.module.css';

/**
 * Телефон экстренной службы с кнопкой набора.
 *
 * Разница принципиальная: 112, скорая и полиция принимают вызов только
 * по телефону. Поэтому здесь не «отправить вызов», а «позвонить» — ссылка
 * `tel:` открывает набор на телефоне, человеку остаётся нажать «вызов».
 *
 * Притворяться, что приложение дозвонилось, нельзя: человек отложит телефон
 * и будет ждать ответа, которого не будет.
 */
const PHONE_SERVICES = [
  { number: '112', label: 'Единый номер', hint: 'Все экстренные службы' },
  { number: '103', label: 'Скорая', hint: 'Медицинская помощь' },
  { number: '102', label: 'Полиция', hint: 'Правонарушения' },
  { number: '101', label: 'Пожарные', hint: 'Возгорание' },
  { number: '104', label: 'Газовая служба', hint: 'Запах газа' },
] as const;

const CONTACT_KINDS: Record<string, string> = {
  uk: 'Управляющая компания',
  district: 'Участковый',
  provider: 'Провайдеры и связь',
  clinic: 'Медицина',
  emergency: 'Аварийные службы',
  other: 'Прочее',
};

const STATUS_LABELS: Record<EmergencyCall['status'], string> = {
  requested: 'Отправлен',
  accepted: 'Принят',
  cancelled: 'Отменён',
};

const KIND_LABELS: Record<EmergencyCall['kind'], string> = {
  uk_duty: 'Аварийная УК',
  police: 'Полиция',
  ambulance: 'Скорая',
  fire: 'Пожарные',
  gas: 'Газовая служба',
};

export function EmergencyPage() {
  const calls = useEmergencyCalls();
  const contacts = useContacts();

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const handleDutyCall = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await createEmergencyCall('uk_duty');
      setNotice({ ok: result.ok, text: result.message });
      if (result.ok) calls.reload();
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (callId: string) => {
    const result = await cancelEmergencyCall(callId);
    setNotice({ ok: result.ok, text: result.message });
    if (result.ok) calls.reload();
  };

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Экстренно</h1>
          <p className={pageStyles.pageSubtitle}>Звонки в экстренные службы и полезные телефоны</p>
        </div>
      </div>

      {notice && (
        <p
          className={`${styles.notice} ${notice.ok ? styles.noticeOk : styles.noticeError}`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      {/* ─── 112 и экстренные службы: звонок, не заявка ────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Экстренные службы</h2>
        <p className={styles.hint} style={{ marginTop: 0 }}>
          Нажатие открывает набор номера в телефоне — останется нажать «Вызов».
        </p>

        <div className={styles.phoneGrid}>
          {PHONE_SERVICES.map((service) => (
            <a
              key={service.number}
              className={
                service.number === '112' ? styles.phoneBig : styles.phoneItem
              }
              href={`tel:${service.number}`}
            >
              <span className={styles.phoneNumber}>{service.number}</span>
              <span className={styles.phoneLabel}>{service.label}</span>
              <span className={styles.phoneHint}>{service.hint}</span>
            </a>
          ))}
        </div>
      </section>

      {/* ─── Аварийная УК: это наша служба, вызов уходит по-настоящему ─── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Аварийная служба УК</h2>
        <p className={styles.hint} style={{ marginTop: 0 }}>
          Замок, протечка, электричество, лифт — то, что нельзя отложить. Вызов уходит
          диспетчеру сразу, с адресом и квартирой.
        </p>
        <ul className={styles.compareList}>
          <li>
            <strong>Аварийный вызов</strong> — угроза жизни или имуществу; диспетчер видит
            сигнал сразу, без очереди и срока.
          </li>
          <li>
            <strong>Обычная заявка</strong> — плановый ремонт; срок зависит от категории,
            можно приложить фото и следить за историей.
          </li>
        </ul>
        <Button block loading={busy} onClick={() => void handleDutyCall()}>
          Вызвать аварийную службу УК
        </Button>
        <p className={styles.hint}>
          Плановый вопрос?{' '}
          <Link to="/my-requests/new" className={styles.inlineLink}>
            Подайте заявку
          </Link>{' '}
          — она попадёт в общую очередь УК.
        </p>
      </section>

      {calls.items.length > 0 && (
        <>
          <h2 className={styles.sectionTitle}>Мои вызовы</h2>
          <div className={styles.list}>
            {calls.items.map((call) => (
              <div key={call.id} className={styles.listItem}>
                <span>
                  {KIND_LABELS[call.kind]} · {STATUS_LABELS[call.status]}
                  {call.status === 'requested' && (
                    <Button variant="ghost" compact onClick={() => void handleCancel(call.id)}>
                      Отменить
                    </Button>
                  )}
                </span>
                <span className={styles.listTime} title={formatDateTime(call.createdAt)}>
                  {formatRelative(call.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ─── Полезные телефоны ────────────────────────────────────────── */}
      <h2 className={styles.sectionTitle}>Полезные телефоны</h2>

      {contacts.loading ? (
        <CenteredSpinner label="Загружаем телефоны" />
      ) : contacts.items.length === 0 ? (
        <p className={styles.empty}>Управляющая компания пока не добавила телефоны</p>
      ) : (
        <div className={styles.list}>
          {contacts.items.map((contact) => (
            <div key={contact.id} className={styles.listItem}>
              <span>
                {contact.name}
                <br />
                <span className={styles.listTime}>
                  {CONTACT_KINDS[contact.kind] ?? contact.kind}
                  {contact.note ? ` · ${contact.note}` : ''}
                </span>
              </span>
              <a className={styles.phoneLink} href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>
                {contact.phone}
              </a>
            </div>
          ))}
        </div>
      )}

      {/* ─── Единая лента сообщений УК ─────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Объявления и сообщения УК</h2>
        <p className={styles.hint} style={{ marginTop: 0 }}>
          График работ, отключения, аварии и важные события — в одном разделе.
          Важные сообщения помечены.
        </p>
        <Link to="/news" className={styles.inlineLink}>
          Открыть объявления
        </Link>
      </section>
    </div>
  );
}
