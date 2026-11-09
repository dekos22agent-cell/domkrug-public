import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { Button } from '@ui/Button';
import { useNavigate } from 'react-router-dom';
import { useIntercomHistory } from '@shared/useVideo';
import { useAccessPoints, useAccessEvents, openAccessPoint } from '@shared/useAccess';
import { formatDateTime, formatRelative } from '@shared/format';
import type { AccessPoint } from '@shared/types';
import styles from './AccessPage.module.css';
import pageStyles from './pages.module.css';

/**
 * Экран «Доступ».
 *
 * Кнопка «Открыть» уходит на сервер и дальше в устройство: у стенда это
 * вызывная панель Hikvision, у демо-дома — заглушка mock. Внешний вид и права
 * при смене вендора не меняются — меняется только провайдер на сервере.
 *
 * Кнопки «Смоделировать звонок» здесь больше нет: звонок создаёт сама панель,
 * а окно «Вам звонят» всплывает само. Отладочный вызов остался только в API
 * (`POST /resident/video/intercom/demo-call`) — им пользуются тесты.
 */
export function AccessPage() {
  const navigate = useNavigate();
  const { items: points, loading, error, reload } = useAccessPoints();
  const { items: events, reload: reloadEvents } = useAccessEvents(20);
  const calls = useIntercomHistory(10);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  /*
   * Строка «Открыто» должна исчезать сама.
   *
   * Раньше она висела до перезагрузки страницы, и житель не понимал, закрылась
   * дверь или нет. Четырёх секунд хватает прочитать, но не мешает нажать
   * следующую кнопку. Таймер сбрасываем при каждом новом сообщении — иначе
   * старое сообщение гасило бы новое.
   */
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // Группируем по дому: у жителя может быть две квартиры в разных УК
  const groups = useMemo(() => {
    const map = new Map<string, { address: string; points: AccessPoint[] }>();
    for (const point of points) {
      const group = map.get(point.buildingId) ?? { address: point.buildingAddress, points: [] };
      group.points.push(point);
      map.set(point.buildingId, group);
    }
    return [...map.values()];
  }, [points]);

  const handleOpen = async (point: AccessPoint) => {
    setBusyId(point.id);
    setToast(null);
    try {
      const result = await openAccessPoint(point.id, 'app');
      showToast(result.ok, result.message);
      if (result.ok) reloadEvents();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {

    return <CenteredSpinner label="Загружаем точки доступа" />;
  }

  if (error) {
    return (
      <EmptyState
        title="Не удалось загрузить доступ"
        description={error}
        action={
          <Button variant="secondary" onClick={reload}>
            Повторить
          </Button>
        }
      />
    );
  }

  if (points.length === 0) {
    return (
      <>
        <div className={pageStyles.pageHeader}>
          <div>
            <h1 className={pageStyles.pageTitle}>Доступ</h1>
            <p className={pageStyles.pageSubtitle}>Двери, калитки и шлагбаумы</p>
          </div>
        </div>
        <EmptyState
          title="Пока нечего открывать"
          description="Точки доступа появятся, когда управляющая компания подключит оборудование к вашему дому и подтвердит привязку квартиры."
          action={
            <Button variant="secondary" onClick={() => navigate('/binding')}>
              Моя квартира
            </Button>
          }
        />
      </>
    );
  }

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Доступ</h1>
          <p className={pageStyles.pageSubtitle}>
            Нажмите, чтобы открыть. Работает рядом с домом.
          </p>
        </div>
      </div>

      {toast && (
        <div
          className={`${styles.toast} ${toast.ok ? styles.toastOk : styles.toastError}`}
          role="status"
        >
          {toast.text}
        </div>
      )}

      {groups.map((group) => (
        <section key={group.address} className={styles.group}>
          <h2 className={styles.groupTitle}>
            <span>Точки доступа</span>
            <span className={styles.groupAddress}>{group.address}</span>
          </h2>

          <div className={styles.points}>
            {group.points.map((point) => (
              <button
                key={point.id}
                type="button"
                className={[
                  styles.point,
                  busyId === point.id ? styles.pointBusy : '',
                  !point.isActive ? styles.pointDisabled : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={busyId !== null || !point.isActive}
                onClick={() => void handleOpen(point)}
              >
                <span className={styles.pointIcon} aria-hidden="true">
                  <AccessIcon kind={point.kind} />
                </span>
                <span className={styles.pointBody}>
                  <span className={styles.pointName}>{point.name}</span>
                  <span className={styles.pointHint}>
                    {point.isActive
                      ? (point.instruction ?? 'Нажмите, чтобы открыть')
                      : 'Временно отключено управляющей компанией'}
                  </span>
                </span>
                <span className={styles.pointAction}>
                  {busyId === point.id ? '…' : point.isActive ? 'Открыть' : '—'}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <section className={styles.callCard}>
        <h2 className={styles.groupTitle}>
          <span>Видеозвонок</span>
        </h2>
        <p className={styles.callText}>
          Когда гость нажимает кнопку на вызывной панели, поверх экрана появится картинка с
          камеры и кнопки «Открыть» и «Отклонить» — как звонок в домофон. Запускать ничего
          не нужно. Это окно появляется только тогда, когда звонят именно в вашу квартиру.
        </p>
      </section>

      <section>
        <h2 className={styles.groupTitle}>
          <span>Звонки в домофон</span>
        </h2>

        {calls.loading ? (
          <p className={styles.empty}>Загружаем…</p>
        ) : calls.items.length === 0 ? (
          <p className={styles.empty}>Пока не звонили</p>
        ) : (
          <div className={styles.journal}>
            {calls.items.map((call) => (
              <div key={call.id} className={styles.event}>
                <span className={styles.eventName}>
                  <span
                    className={[
                      styles.eventDot,
                      call.status === 'missed' ? styles.eventDotError : '',
                      call.status === 'declined' ? styles.eventDotDenied : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                  {call.pointName}
                  <span className={styles.eventMeta}>
                    {' '}
                    · кв. {call.apartmentNumber} · {formatCallStatus(call.status)}
                  </span>
                </span>
                <span className={styles.eventTime} title={formatDateTime(call.startedAt)}>
                  {formatRelative(call.startedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className={styles.groupTitle}>
          <span>Последние открытия</span>
        </h2>

        {events.length === 0 ? (
          <p className={styles.empty}>Пока не открывали</p>
        ) : (
          <div className={styles.journal}>
            {events.map((event) => (
              <div key={event.id} className={styles.event}>
                <span className={styles.eventName}>
                  <span
                    className={[
                      styles.eventDot,
                      event.result === 'error' ? styles.eventDotError : '',
                      event.result === 'denied' ? styles.eventDotDenied : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-hidden="true"
                  />
                  {event.pointName}
                  {event.actor && (
                    <span className={styles.eventMeta}> · {event.actor}</span>
                  )}
                  {event.result !== 'ok' && ' — не открылось'}
                </span>
                <span className={styles.eventTime} title={formatDateTime(event.createdAt)}>
                  {formatRelative(event.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className={styles.demoNote}>
          Демонстрационный режим: команда не уходит на оборудование, дверь физически не
          открывается. Так проверяются права и журнал до подключения реального вендора.
        </p>
      </section>
    </div>
  );
}

/** Иконки точек: дверь, калитка, шлагбаум. */
function AccessIcon({ kind }: { kind: AccessPoint['kind'] }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (kind === 'barrier' || kind === 'gate' || kind === 'parking') {
    return (
      <svg {...common}>
        <path d="M3 17V9l4-3 4 3v8" />
        <path d="M11 9h10v8H11" />
        <path d="M3 17h18" />
      </svg>
    );
  }

  if (kind === 'wicket') {
    return (
      <svg {...common}>
        <path d="M6 21V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v15" />
        <path d="M4 21h16" />
        <path d="M12 5v16" strokeDasharray="2 3" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M6 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
      <path d="M4 21h16" />
      <circle cx="13.5" cy="12" r="1" />
    </svg>
  );
}


/**
 * Как читать статус звонка.
 *
 * «Открыли» и «Пропущен» — главное, что нужно жителю; технические `ringing`
 * и `ended` показываем словами, чтобы не пугать английскими кодами.
 */
function formatCallStatus(status: string): string {
  switch (status) {
    case 'opened':
      return 'открыли';
    case 'missed':
      return 'пропущен';
    case 'declined':
      return 'отклонили';
    case 'ringing':
      return 'идёт';
    default:
      return 'завершён';
  }
}