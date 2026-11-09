import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '@ui/Alert';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { DataTable, type DataTableColumn } from '@ui/DataTable';
import { Drawer } from '@ui/Drawer';
import { EmptyState } from '@ui/EmptyState';
import { Field } from '@ui/Field';
import { Select } from '@ui/Select';
import { CenteredSpinner } from '@ui/Spinner';
import { ApiError } from '@shared/api';
import {
  createStaffMeter,
  updateStaffMeter,
  useApartments,
  useBuildingMeters,
  useBuildingPassport,
} from '@shared/useStructure';
import type { MeterKind, StaffMeterItem } from '@shared/types';
import { ObjectTabs } from './ObjectTabs';
import pageStyles from './pages.module.css';
import styles from './ObjectMetersPage.module.css';

const KIND_OPTIONS: { value: MeterKind; label: string; unit: string }[] = [
  { value: 'cold_water', label: 'Холодная вода', unit: 'м³' },
  { value: 'hot_water', label: 'Горячая вода', unit: 'м³' },
  { value: 'electricity', label: 'Электричество', unit: 'кВт·ч' },
  { value: 'heat', label: 'Тепло', unit: 'Гкал' },
  { value: 'gas', label: 'Газ', unit: 'м³' },
];

function kindLabel(kind: MeterKind): string {
  return KIND_OPTIONS.find((item) => item.value === kind)?.label ?? kind;
}

interface MeterForm {
  apartmentId: string;
  kind: MeterKind;
  serial: string;
  unit: string;
  verificationDue: string;
  isActive: boolean;
  initialValue: string;
}

function emptyForm(apartmentId = ''): MeterForm {
  return {
    apartmentId,
    kind: 'cold_water',
    serial: '',
    unit: 'м³',
    verificationDue: '',
    isActive: true,
    initialValue: '',
  };
}

function toForm(meter: StaffMeterItem): MeterForm {
  return {
    apartmentId: meter.apartmentId,
    kind: meter.kind,
    serial: meter.serial ?? '',
    unit: meter.unit,
    verificationDue: meter.verificationDue ?? '',
    isActive: meter.isActive,
    initialValue: meter.lastValue != null ? String(meter.lastValue) : '',
  };
}

/** Счётчики объекта: УК заводит приборы, житель передаёт показания. */
export function ObjectMetersPage() {
  const { id } = useParams<{ id: string }>();
  const object = useBuildingPassport(id ?? null);
  const meters = useBuildingMeters(id ?? null);
  const apartments = useApartments(id ?? null);
  const [editing, setEditing] = useState<StaffMeterItem | null>(null);
  const [form, setForm] = useState<MeterForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(apartments.items[0]?.id ?? ''));
    setError(null);
    setNotice(null);
  };

  const openEdit = (meter: StaffMeterItem) => {
    setEditing(meter);
    setForm(toForm(meter));
    setError(null);
    setNotice(null);
  };

  const handleSave = async () => {
    if (!id || !form) return;
    if (!form.apartmentId) {
      setError('Выберите помещение');
      return;
    }
    const initial = form.initialValue.trim() === ''
      ? null
      : Number(form.initialValue.replace(',', '.'));
    if (initial !== null && (!Number.isFinite(initial) || initial < 0)) {
      setError('Начальное показание должно быть неотрицательным');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        kind: form.kind,
        serial: form.serial.trim() || null,
        unit: form.unit.trim(),
        verificationDue: form.verificationDue || null,
        isActive: form.isActive,
      };
      if (editing) {
        await updateStaffMeter(id, editing.id, payload);
        setNotice('Счётчик обновлён');
      } else {
        await createStaffMeter(id, form.apartmentId, { ...payload, initialValue: initial });
        setNotice('Счётчик добавлен');
      }
      setEditing(null);
      setForm(null);
      meters.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить счётчик');
    } finally {
      setSaving(false);
    }
  };

  if (object.loading) return <CenteredSpinner label="Загружаем счётчики" />;
  if (object.error || !object.data) {
    return (
      <div className={styles.page}>
        <Link to="/objects" className={styles.back}>
          ← Объекты
        </Link>
        <Alert variant="danger">{object.error ?? 'Объект не найден'}</Alert>
      </div>
    );
  }

  const building = object.data.building;

  const columns: DataTableColumn<StaffMeterItem>[] = [
    {
      key: 'apartment',
      header: 'Помещение',
      width: '120px',
      render: (meter) => <strong className={styles.apartment}>кв. {meter.apartmentNumber}</strong>,
    },
    {
      key: 'kind',
      header: 'Прибор',
      render: (meter) => (
        <span className={styles.meter}>
          <strong>{kindLabel(meter.kind)}</strong>
          <span className={styles.serial}>
            {meter.serial ? `№ ${meter.serial}` : 'Серийный номер не указан'}
          </span>
        </span>
      ),
    },
    {
      key: 'last',
      header: 'Последнее показание',
      width: '190px',
      hideOnMobile: true,
      render: (meter) =>
        meter.lastValue != null ? (
          <span>
            {meter.lastValue.toLocaleString('ru-RU')} {meter.unit}
            {meter.lastPeriod ? ` · ${meter.lastPeriod}` : ''}
          </span>
        ) : (
          <span className={styles.muted}>Показаний нет</span>
        ),
    },
    {
      key: 'verification',
      header: 'Поверка',
      width: '140px',
      hideOnMobile: true,
      render: (meter) => (
        <span className={styles.muted}>
          {meter.verificationDue
            ? new Date(`${meter.verificationDue}T00:00:00`).toLocaleDateString('ru-RU')
            : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      width: '120px',
      render: (meter) => (
        <Badge variant={meter.isActive ? 'success' : 'neutral'}>
          {meter.isActive ? 'Активен' : 'Отключён'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '110px',
      render: (meter) => (
        <Button compact variant="secondary" onClick={() => openEdit(meter)}>
          Изменить
        </Button>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <Link to={`/objects/${id}`} className={styles.back}>
        ← Паспорт объекта
      </Link>

      <div className={styles.header}>
        <div>
          <div className={styles.kicker}>
            <Badge variant="info">{building.objectKind === 'apartment_building' ? 'МКД' : 'Объект'}</Badge>
            <span>{building.addressText}</span>
          </div>
          <h1 className={pageStyles.pageTitle}>Счётчики</h1>
          <p className={pageStyles.pageSubtitle}>
            Приборы учёта помещений: УК заводит и отключает, житель передаёт показания.
          </p>
        </div>
        <Button onClick={openCreate} disabled={apartments.items.length === 0}>
          Добавить счётчик
        </Button>
      </div>

      <ObjectTabs objectId={id ?? ''} active="meters" />

      {notice && (
        <Alert variant="success" className={styles.notice}>
          {notice}
        </Alert>
      )}

      {meters.loading ? (
        <CenteredSpinner label="Загружаем счётчики" />
      ) : meters.error ? (
        <p className={pageStyles.loadError}>{meters.error}</p>
      ) : meters.items.length === 0 ? (
        <EmptyState
          title="Счётчиков пока нет"
          description="Добавьте прибор — после этого житель сможет передавать показания."
          action={
            apartments.items.length > 0 ? (
              <Button onClick={openCreate}>Добавить счётчик</Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={meters.items}
          getRowKey={(meter) => meter.id}
          density="compact"
          ariaLabel="Счётчики объекта"
          onRowClick={openEdit}
          getRowAriaLabel={(meter) => `Изменить счётчик ${kindLabel(meter.kind)}`}
        />
      )}

      {form && (
        <Drawer
          title={editing ? 'Изменить счётчик' : 'Добавить счётчик'}
          onClose={() => {
            setForm(null);
            setEditing(null);
          }}
        >
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <Select
              label="Помещение"
              value={form.apartmentId}
              onChange={(event) => setForm({ ...form, apartmentId: event.target.value })}
              disabled={Boolean(editing)}
            >
              {apartments.items.map((apartment) => (
                <option key={apartment.id} value={apartment.id}>
                  кв. {apartment.number}
                </option>
              ))}
            </Select>

            <Select
              label="Тип прибора"
              value={form.kind}
              onChange={(event) => {
                const kind = event.target.value as MeterKind;
                const unit = KIND_OPTIONS.find((item) => item.value === kind)?.unit ?? form.unit;
                setForm({ ...form, kind, unit });
              }}
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>

            <div className={styles.formGrid}>
              <Field
                label="Серийный номер"
                value={form.serial}
                onChange={(event) => setForm({ ...form, serial: event.target.value })}
              />
              <Field
                label="Единица"
                value={form.unit}
                onChange={(event) => setForm({ ...form, unit: event.target.value })}
              />
              <Field
                label="Поверка до"
                type="date"
                value={form.verificationDue}
                onChange={(event) => setForm({ ...form, verificationDue: event.target.value })}
              />
              {!editing && (
                <Field
                  label="Начальное показание"
                  type="number"
                  min={0}
                  step={0.001}
                  value={form.initialValue}
                  onChange={(event) => setForm({ ...form, initialValue: event.target.value })}
                  hint="Можно оставить пустым"
                />
              )}
            </div>

            <Select
              label="Статус"
              value={form.isActive ? 'active' : 'inactive'}
              onChange={(event) =>
                setForm({ ...form, isActive: event.target.value === 'active' })
              }
            >
              <option value="active">Активен</option>
              <option value="inactive">Отключён</option>
            </Select>

            {error && <Alert variant="danger">{error}</Alert>}

            <div className={styles.formActions}>
              <Button type="submit" loading={saving}>
                Сохранить
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setForm(null);
                  setEditing(null);
                }}
              >
                Отмена
              </Button>
            </div>
          </form>
        </Drawer>
      )}
    </div>
  );
}
