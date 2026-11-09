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
  saveApartmentDetails,
  useApartments,
  useBuildingPassport,
} from '@shared/useStructure';
import { APARTMENT_KIND_OPTIONS, apartmentKindLabel } from '@shared/objectKind';
import type { ApartmentListItem } from '@shared/types';
import { ObjectTabs } from './ObjectTabs';
import pageStyles from './pages.module.css';
import styles from './ObjectUnitsPage.module.css';

interface UnitForm {
  kind: string;
  rooms: string;
  areaTotal: string;
  status: 'active' | 'archived';
}

/** Помещения объекта внутри паспорта: тип, комнатность, площадь. */
export function ObjectUnitsPage() {
  const { id } = useParams<{ id: string }>();
  const object = useBuildingPassport(id ?? null);
  const units = useApartments(id ?? null);
  const [editing, setEditing] = useState<ApartmentListItem | null>(null);
  const [form, setForm] = useState<UnitForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const openEdit = (unit: ApartmentListItem) => {
    setEditing(unit);
    setForm({
      kind: unit.kind,
      rooms: unit.rooms != null ? String(unit.rooms) : '',
      areaTotal: unit.areaTotal ? String(Number(unit.areaTotal)) : '',
      status: unit.status,
    });
    setError(null);
    setNotice(null);
  };

  const handleSave = async () => {
    if (!id || !editing || !form) return;
    const rooms = form.rooms.trim() === '' ? null : Number(form.rooms);
    const area = form.areaTotal.trim() === ''
      ? null
      : Number(form.areaTotal.replace(',', '.'));
    if (rooms !== null && (!Number.isInteger(rooms) || rooms < 0 || rooms > 20)) {
      setError('Комнатность — целое число от 0 до 20');
      return;
    }
    if (area !== null && (!Number.isFinite(area) || area <= 0)) {
      setError('Площадь должна быть больше нуля');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await saveApartmentDetails(id, editing.id, {
        kind: form.kind,
        rooms,
        areaTotal: area,
        status: form.status,
      });
      setEditing(null);
      setForm(null);
      setNotice('Помещение обновлено');
      units.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить помещение');
    } finally {
      setSaving(false);
    }
  };

  if (object.loading) return <CenteredSpinner label="Загружаем помещения" />;
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

  const columns: DataTableColumn<ApartmentListItem>[] = [
    {
      key: 'number',
      header: 'Помещение',
      width: '150px',
      render: (unit) => <strong className={styles.number}>{unit.number}</strong>,
    },
    {
      key: 'kind',
      header: 'Тип',
      width: '160px',
      render: (unit) => <span className={styles.kind}>{apartmentKindLabel(unit.kind)}</span>,
    },
    {
      key: 'rooms',
      header: 'Комнат',
      width: '90px',
      hideOnMobile: true,
      render: (unit) => unit.rooms ?? '—',
    },
    {
      key: 'area',
      header: 'Площадь',
      width: '120px',
      render: (unit) =>
        unit.areaTotal ? `${Number(unit.areaTotal).toLocaleString('ru-RU')} м²` : '—',
    },
    {
      key: 'status',
      header: 'Статус',
      width: '120px',
      hideOnMobile: true,
      render: (unit) => (
        <Badge variant={unit.status === 'active' ? 'success' : 'neutral'}>
          {unit.status === 'active' ? 'Активно' : 'Архив'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '110px',
      render: (unit) => (
        <Button compact variant="secondary" onClick={() => openEdit(unit)}>
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
          <h1 className={pageStyles.pageTitle}>Помещения</h1>
          <p className={pageStyles.pageSubtitle}>
            Квартиры, нежилые помещения, дома, паркинг и кладовые.
          </p>
        </div>
        <Link className={styles.importLink} to={`/objects/${id}/import`}>
          Импорт CSV
        </Link>
      </div>

      <ObjectTabs objectId={id ?? ''} active="units" />

      {notice && (
        <Alert variant="success" className={styles.notice}>
          {notice}
        </Alert>
      )}

      {units.loading ? (
        <CenteredSpinner label="Загружаем помещения" />
      ) : units.error ? (
        <p className={pageStyles.loadError}>{units.error}</p>
      ) : units.items.length === 0 ? (
        <EmptyState
          title="Помещений пока нет"
          description="Добавьте помещения через импорт CSV или создайте их в другом разделе."
          action={
            <Link className={styles.importLink} to={`/objects/${id}/import`}>
              Импортировать помещения
            </Link>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={units.items}
          getRowKey={(unit) => unit.id}
          density="compact"
          ariaLabel="Помещения объекта"
          onRowClick={openEdit}
          getRowAriaLabel={(unit) => `Изменить помещение ${unit.number}`}
        />
      )}

      {editing && form && (
        <Drawer
          title={`Помещение ${editing.number}`}
          onClose={() => {
            setEditing(null);
            setForm(null);
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
              label="Тип помещения"
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value })}
            >
              {APARTMENT_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <div className={styles.formGrid}>
              <Field
                label="Комнат"
                type="number"
                min={0}
                max={20}
                value={form.rooms}
                onChange={(event) => setForm({ ...form, rooms: event.target.value })}
              />
              <Field
                label="Площадь, м²"
                type="number"
                min={0.01}
                step={0.01}
                value={form.areaTotal}
                onChange={(event) => setForm({ ...form, areaTotal: event.target.value })}
              />
            </div>
            <Select
              label="Статус"
              value={form.status}
              onChange={(event) =>
                setForm({ ...form, status: event.target.value as 'active' | 'archived' })
              }
            >
              <option value="active">Активно</option>
              <option value="archived">Архив</option>
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
                  setEditing(null);
                  setForm(null);
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
