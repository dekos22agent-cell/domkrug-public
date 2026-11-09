import { useState } from 'react';
import { Button } from '@ui/Button';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { useNavigate } from 'react-router-dom';
import { callLift, reportLiftFault, useLifts } from '@shared/useUtilities';
import type { Lift } from '@shared/types';
import styles from './utilities.module.css';
import pageStyles from './pages.module.css';

const STATUS_LABELS: Record<Lift['status'], string> = {
  ok: 'Работает',
  maintenance: 'На обслуживании',
  fault: 'Неисправен',
};

const STATUS_CLASS: Record<Lift['status'], string> = {
  ok: styles.badgeOk,
  maintenance: styles.badgeWarn,
  fault: styles.badgeDanger,
};

/**
 * Лифты: статус, вызов, сообщение о неисправности.
 *
 * Вызов из приложения нужен редко — человек у лифта нажмёт кнопку. Он полезен
 * для гостя или курьера, когда жителя нет дома. А вот сообщить о неисправности
 * нужно по-настоящему, поэтому поле для описания открывается сразу.
 */
export function LiftsPage() {
  const { items, loading, error, reload } = useLifts();
  const navigate = useNavigate();
  const [ticketNumber, setTicketNumber] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [faultFor, setFaultFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const handleCall = async (lift: Lift) => {
    setBusyId(lift.id);
    setNotice(null);
    try {
      const result = await callLift(lift.id);
      setNotice({ ok: result.ok, text: result.message });
      if (result.ok) reload();
    } finally {
      setBusyId(null);
    }
  };

  const handleFault = async (lift: Lift) => {
    setBusyId(lift.id);
    setNotice(null);
    try {
      const result = await reportLiftFault(lift.id, note);
      setNotice({ ok: result.ok, text: result.message });
      if (result.ok && result.ticketNumber) setTicketNumber(result.ticketNumber);
      if (result.ok) {
        setFaultFor(null);
        setNote('');
        reload();
      }
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <CenteredSpinner label="Загружаем лифты" />;

  if (error) {
    return (
      <EmptyState
        title="Не удалось загрузить лифты"
        description={error}
        action={
          <Button variant="secondary" onClick={reload}>
            Повторить
          </Button>
        }
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Лифты</h1>
          <p className={pageStyles.pageSubtitle}>Состояние и вызов</p>
        </div>
      </div>

      {notice && (
        <div
          className={`${styles.notice} ${notice.ok ? styles.noticeOk : styles.noticeError}`}
          role="status"
        >
          {notice.text}
          {ticketNumber !== null && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <Button variant="ghost" compact onClick={() => navigate('/my-requests')}>
                Открыть мои заявки
              </Button>
            </div>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="Лифтов нет"
          description="Если в доме есть лифт, но он не отображается — сообщите в управляющую компанию."
        />
      ) : (
        items.map((lift) => (
          <section key={lift.id} className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Лифт {lift.number}</h2>
              <span className={`${styles.badge} ${STATUS_CLASS[lift.status]}`}>
                {STATUS_LABELS[lift.status]}
              </span>
            </div>

            <div className={styles.row}>
              <span className={styles.rowLabel}>Адрес</span>
              <span className={styles.rowValue}>
                {lift.buildingAddress}
                {lift.entranceNumber ? `, подъезд ${lift.entranceNumber}` : ''}
              </span>
            </div>

            {lift.serviceOrg && (
              <div className={styles.row}>
                <span className={styles.rowLabel}>Обслуживает</span>
                <span className={styles.rowValue}>{lift.serviceOrg}</span>
              </div>
            )}

            <div className={styles.inputRow}>
              <Button
                loading={busyId === lift.id}
                disabled={lift.status === 'fault'}
                onClick={() => void handleCall(lift)}
              >
                {lift.status === 'fault' ? 'Неисправен' : 'Вызвать лифт'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setFaultFor(faultFor === lift.id ? null : lift.id);
                  setNote('');
                }}
              >
                Сообщить о неисправности
              </Button>
            </div>

            {faultFor === lift.id && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <textarea
                  className={styles.input}
                  style={{ width: '100%', minHeight: '80px', padding: 'var(--space-3)' }}
                  placeholder="Например: двери не закрываются на 3 этаже"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={1000}
                  aria-label="Описание неисправности"
                />
                <div className={styles.inputRow}>
                  <Button
                    loading={busyId === lift.id}
                    disabled={note.trim().length < 5}
                    onClick={() => void handleFault(lift)}
                  >
                    Отправить в УК
                  </Button>
                  <Button variant="ghost" onClick={() => setFaultFor(null)}>
                    Отмена
                  </Button>
                </div>
                <p className={styles.hint}>
                  Опишите, что не так: по этому тексту приедет механик. Если в лифте застрял
                  человек — звоните 112, не пишите здесь.
                </p>
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
