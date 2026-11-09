import { useMemo, useState } from 'react';
import { Alert } from '@ui/Alert';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { Card } from '@ui/Card';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { Field } from '@ui/Field';
import { api } from '@shared/api';
import { useApartment } from '@shared/apartmentContext';
import { submitMeterReading, useMeters } from '@shared/useUtilities';
import type { Meter } from '@shared/types';
import styles from './MetersPage.module.css';
import pageStyles from './pages.module.css';

interface MeterReading {
  period: string;
  value: number;
}

const KIND_LABELS: Record<Meter['kind'], string> = {
  cold_water: 'Холодная вода',
  hot_water: 'Горячая вода',
  electricity: 'Электричество',
  heat: 'Отопление',
  gas: 'Газ',
};

/**
 * Счётчики: текущие значения, передача показаний, история.
 *
 * Ввод остаётся простым числом: житель списывает цифры с табло прибора.
 * Никаких «умных» подсказок в поле — они мешают, когда человек стоит
 * у счётчика с фонариком.
 */
export function MetersPage() {
  const { items: allMeters, loading, error, reload } = useMeters();
  const { active } = useApartment();

  const items = useMemo(
    () => (active ? allMeters.filter((meter) => meter.apartmentId === active.apartmentId) : []),
    [allMeters, active],
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<Record<string, MeterReading[]>>({});
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});
  const [historyError, setHistoryError] = useState<Record<string, string | null>>({});

  const toggleHistory = async (meter: Meter) => {
    const next = !historyOpen[meter.id];
    setHistoryOpen((prev) => ({ ...prev, [meter.id]: next }));
    if (!next || history[meter.id] || historyLoading[meter.id]) return;

    setHistoryLoading((prev) => ({ ...prev, [meter.id]: true }));
    setHistoryError((prev) => ({ ...prev, [meter.id]: null }));
    try {
      const response = await api.get<{ items: MeterReading[] }>(
        `/resident/meters/${meter.id}/readings`,
      );
      setHistory((prev) => ({ ...prev, [meter.id]: response.items }));
    } catch {
      setHistoryError((prev) => ({
        ...prev,
        [meter.id]: 'Не удалось загрузить историю',
      }));
    } finally {
      setHistoryLoading((prev) => ({ ...prev, [meter.id]: false }));
    }
  };

  const submit = async (meter: Meter) => {
    const raw = values[meter.id] ?? '';
    const value = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(value) || value < 0) {
      setNotice({ ok: false, text: 'Введите показание числом' });
      return;
    }

    setBusyId(meter.id);
    setNotice(null);
    try {
      const result = await submitMeterReading(meter.id, value);
      setNotice({ ok: result.ok, text: result.message });
      if (result.ok) {
        setValues((prev) => ({ ...prev, [meter.id]: '' }));
        reload();
      }
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <CenteredSpinner label="Загружаем счётчики" />;

  if (error) {
    return (
      <EmptyState
        title="Не удалось загрузить счётчики"
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
          <h1 className={pageStyles.pageTitle}>Счётчики</h1>
          <p className={pageStyles.pageSubtitle}>Показания за текущий месяц</p>
        </div>
      </div>

      {notice && (
        <Alert variant={notice.ok ? 'success' : 'danger'} className={styles.notice}>
          {notice.text}
        </Alert>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="Счётчиков нет"
          description="Приборы учёта появятся, когда управляющая компания добавит их для вашей квартиры."
        />
      ) : (
        items.map((meter) => (
          <Card key={meter.id} className={styles.meterCard}>
            <div className={styles.cardHead}>
              <div>
                <h2 className={styles.cardTitle}>{KIND_LABELS[meter.kind]}</h2>
                <span className={styles.cardMeta}>
                  {meter.serial ? `№ ${meter.serial} · ` : ''}
                  {meter.unit}
                </span>
              </div>
              <Badge variant={meter.currentSubmitted ? 'success' : 'neutral'}>
                {meter.currentSubmitted ? 'Передано' : 'Не передано'}
              </Badge>
            </div>

            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Прошлое показание</span>
                <span className={styles.rowValue}>
                  {meter.lastValue === null ? '—' : `${meter.lastValue} ${meter.unit}`}
                </span>
              </div>

              <div className={styles.row}>
                <span className={styles.rowLabel}>За текущий месяц</span>
                <span className={styles.rowValue}>
                  {meter.currentSubmitted ? `${meter.currentValue} ${meter.unit}` : 'не передано'}
                </span>
              </div>

              {meter.verificationDue && (
                <div className={styles.row}>
                  <span className={styles.rowLabel}>Поверка до</span>
                  <span className={styles.rowValue}>{formatDate(meter.verificationDue)}</span>
                </div>
              )}
            </div>

            <div className={styles.entry}>
              <Field
                label={`Показание, ${meter.unit}`}
                type="text"
                inputMode="decimal"
                placeholder={
                  meter.currentSubmitted
                    ? String(meter.currentValue ?? '')
                    : meter.lastValue === null
                      ? 'Показание'
                      : String(meter.lastValue)
                }
                value={values[meter.id] ?? ''}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, [meter.id]: event.target.value }))
                }
                hint={
                  meter.currentSubmitted
                    ? 'Показание за этот месяц уже передано — можно исправить.'
                    : 'Введите цифры с табло прибора. Показание не может быть меньше прошлого.'
                }
              />
              <Button loading={busyId === meter.id} onClick={() => void submit(meter)}>
                Передать
              </Button>
            </div>

            <div className={styles.historyHead}>
              <Button
                compact
                variant="ghost"
                onClick={() => void toggleHistory(meter)}
                aria-expanded={Boolean(historyOpen[meter.id])}
              >
                {historyOpen[meter.id] ? 'Скрыть историю' : 'История показаний'}
              </Button>
            </div>

            {historyOpen[meter.id] && (
              <div className={styles.history}>
                {historyLoading[meter.id] ? (
                  <CenteredSpinner label="Загружаем историю" />
                ) : historyError[meter.id] ? (
                  <p className={styles.historyError}>{historyError[meter.id]}</p>
                ) : (history[meter.id]?.length ?? 0) === 0 ? (
                  <p className={styles.historyEmpty}>Показаний пока нет.</p>
                ) : (
                  (() => {
                    const rows = withDeltas(history[meter.id] ?? []);
                    return (
                      <>
                        <MeterChart rows={rows} unit={meter.unit} />
                        <div className={styles.historyRows}>
                          {rows.map((reading) => (
                            <div key={reading.period} className={styles.historyRow}>
                              <span>{formatPeriod(reading.period)}</span>
                              <span className={styles.historyValue}>
                                {reading.value.toLocaleString('ru-RU')} {meter.unit}
                              </span>
                              <span className={styles.historyDelta}>
                                {reading.delta === null
                                  ? '—'
                                  : `+${reading.delta.toLocaleString('ru-RU')}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()
                )}
              </div>
            )}
          </Card>
        ))
      )}

      <p className={styles.footnote}>
        Показания передаются раз в месяц. При замене прибора сообщите в управляющую компанию:
        показания нового счётчика начинаются с нуля.
      </p>
    </div>
  );
}

/** «2026-12-01» → «12.2026» */
function formatPeriod(iso: string): string {
  const parts = iso.split('-');
  return parts.length >= 2 ? `${parts[1]}.${parts[0]}` : iso;
}

interface ReadingRow {
  period: string;
  value: number;
  delta: number | null;
}

/**
 * Столбики расхода по месяцам. Высота — относительно максимального расхода
 * в выборке, а не абсолютное значение счётчика: так видно сезонность.
 */
function MeterChart({ rows, unit }: { rows: ReadingRow[]; unit: string }) {
  const bars = rows.filter((row) => row.delta !== null).reverse();
  if (bars.length < 2) return null;

  const max = Math.max(...bars.map((row) => row.delta ?? 0), 1);
  const caption = bars
    .map((row) => `${formatPeriod(row.period)}: ${row.delta} ${unit}`)
    .join(', ');

  return (
    <div className={styles.chart}>
      <div className={styles.chartTitle}>Расход по месяцам</div>
      <div className={styles.chartBars} role="img" aria-label={`Расход: ${caption}`}>
        {bars.map((row) => (
          <span
            key={row.period}
            className={styles.chartBar}
            style={{ height: `${Math.max(4, ((row.delta ?? 0) / max) * 100)}%` }}
            title={`${formatPeriod(row.period)}: +${row.delta} ${unit}`}
          />
        ))}
      </div>
      <div className={styles.chartLabels} aria-hidden="true">
        {bars.map((row) => (
          <span key={row.period}>{formatPeriod(row.period).slice(0, 2)}</span>
        ))}
      </div>
    </div>
  );
}

function withDeltas(items: MeterReading[]): ReadingRow[] {
  const ascending = [...items].sort((a, b) => a.period.localeCompare(b.period));
  return ascending
    .map((item, index) => ({
      ...item,
      delta: index > 0 ? Number((item.value - ascending[index - 1].value).toFixed(1)) : null,
    }))
    .reverse();
}

function formatDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}
