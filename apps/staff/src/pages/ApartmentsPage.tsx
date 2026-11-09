import { useState } from 'react';
import { Alert } from '@ui/Alert';
import { Button } from '@ui/Button';
import { DataTable, type DataTableColumn } from '@ui/DataTable';
import { Drawer } from '@ui/Drawer';
import { EmptyState } from '@ui/EmptyState';
import { Field } from '@ui/Field';
import { FilterBar } from '@ui/FilterBar';
import { Select } from '@ui/Select';
import { CenteredSpinner } from '@ui/Spinner';
import { ApiError } from '@shared/api';
import {
  autofillApartmentRooms,
  saveApartmentDetails,
  saveApartmentRoom,
  useApartments,
  useBuildings,
} from '@shared/useStructure';
import { APARTMENT_KIND_OPTIONS, apartmentKindLabel } from '@shared/objectKind';
import type { ApartmentListItem } from '@shared/types';
import styles from './ApartmentsPage.module.css';
import pageStyles from './pages.module.css';

/**
 * Квартиры дома и номера на вызывной панели.
 *
 * Панель при звонке набирает короткий номер (в настройках панели это «комната»),
 * а не номер квартиры. Пока номер не задан, звонок в квартиру не приходит —
 * поэтому экран нужен управляющей компании, а не разработчику с SQL.
 *
 * Заполнять двести квартир руками бессмысленно: в большинстве домов номер
 * на панели совпадает с номером квартиры, поэтому есть кнопка «подставить
 * номера квартир». Она заполняет только пустые строки и не трогает то,
 * что монтажник уже настроил иначе.
 */
export function ApartmentsPage() {
  const buildings = useBuildings();
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<ApartmentListItem | null>(null);
  const [editForm, setEditForm] = useState<{
    kind: string;
    rooms: string;
    areaTotal: string;
    status: 'active' | 'archived';
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const buildingId = selectedBuildingId ?? buildings.items[0]?.id ?? null;
  const apartments = useApartments(buildingId, search);
  const withoutRoom = apartments.items.filter((item) => !item.intercomRoom).length;

  const resetFilters = () => {
    setSearch('');
    setSelectedBuildingId(null);
    setDraft({});
    setNotice(null);
  };

  const handleSave = async (apartmentId: string, current: string | null) => {
    if (!buildingId) return;
    const value = draft[apartmentId] ?? current ?? '';
    setSavingId(apartmentId);
    setNotice(null);
    try {
      const result = await saveApartmentRoom(buildingId, apartmentId, value);
      setNotice({ ok: result.ok, text: result.message });
      if (result.ok) {
        setDraft((prev) => {
          const next = { ...prev };
          delete next[apartmentId];
          return next;
        });
        apartments.reload();
      }
    } finally {
      setSavingId(null);
    }
  };

  const handleAutofill = async () => {
    if (!buildingId) return;
    setFilling(true);
    setNotice(null);
    try {
      const result = await autofillApartmentRooms(buildingId);
      setNotice({ ok: result.ok, text: result.message });
      if (result.ok) apartments.reload();
    } finally {
      setFilling(false);
    }
  };

  const openEdit = (apartment: ApartmentListItem) => {
    setEditing(apartment);
    setEditForm({
      kind: apartment.kind,
      rooms: apartment.rooms != null ? String(apartment.rooms) : '',
      areaTotal: apartment.areaTotal ? String(Number(apartment.areaTotal)) : '',
      status: apartment.status,
    });
    setEditError(null);
  };

  const handleSaveDetails = async () => {
    if (!buildingId || !editing || !editForm) return;
    const rooms = editForm.rooms.trim() === '' ? null : Number(editForm.rooms);
    const area = editForm.areaTotal.trim() === ''
      ? null
      : Number(editForm.areaTotal.replace(',', '.'));
    if (rooms !== null && (!Number.isInteger(rooms) || rooms < 0 || rooms > 20)) {
      setEditError('Комнатность — целое число от 0 до 20');
      return;
    }
    if (area !== null && (!Number.isFinite(area) || area <= 0)) {
      setEditError('Площадь должна быть больше нуля');
      return;
    }

    setEditSaving(true);
    setEditError(null);
    try {
      await saveApartmentDetails(buildingId, editing.id, {
        kind: editForm.kind,
        rooms,
        areaTotal: area,
        status: editForm.status,
      });
      setEditing(null);
      setEditForm(null);
      setNotice({ ok: true, text: 'Помещение обновлено' });
      apartments.reload();
    } catch (err) {
      setEditError(
        err instanceof ApiError ? err.message : 'Не удалось сохранить помещение',
      );
    } finally {
      setEditSaving(false);
    }
  };

  const columns: DataTableColumn<ApartmentListItem>[] = [
    {
      key: 'apartment',
      header: 'Квартира',
      width: '160px',
      render: (apartment) => (
        <button
          type="button"
          className={styles.numberButton}
          onClick={() => openEdit(apartment)}
          title="Изменить тип и площадь помещения"
        >
          <span className={styles.number}>
            кв. {apartment.number}
            {apartment.residentsConfirmed > 0 && (
              <span className={styles.residents}>{apartment.residentsConfirmed} чел.</span>
            )}
          </span>
        </button>
      ),
    },
    {
      key: 'kind',
      header: 'Тип',
      width: '140px',
      render: (apartment) => (
        <span className={styles.kind}>{apartmentKindLabel(apartment.kind)}</span>
      ),
    },
    {
      key: 'area',
      header: 'Площадь',
      width: '110px',
      hideOnMobile: true,
      render: (apartment) => (
        <span className={styles.muted}>
          {apartment.areaTotal ? `${Number(apartment.areaTotal).toLocaleString('ru-RU')} м²` : '—'}
        </span>
      ),
    },
    {
      key: 'entrance',
      header: 'Подъезд / этаж',
      width: '140px',
      hideOnMobile: true,
      render: (apartment) => (
        <span className={styles.muted}>
          {apartment.entranceNumber ?? '—'} / {apartment.floorNumber ?? '—'}
        </span>
      ),
    },
    {
      key: 'room',
      header: 'Номер на панели',
      width: '240px',
      render: (apartment) => {
        const current = apartment.intercomRoom ?? '';
        const value = draft[apartment.id] ?? current;
        return (
          <input
            className={[styles.roomInput, !current ? styles.roomInputEmpty : '']
              .filter(Boolean)
              .join(' ')}
            value={value}
            inputMode="numeric"
            placeholder="не задан"
            aria-label={`Номер на панели для квартиры ${apartment.number}`}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, [apartment.id]: event.target.value }))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && value.trim() !== current.trim()) {
                void handleSave(apartment.id, current);
              }
            }}
          />
        );
      },
    },
    {
      key: 'actions',
      header: 'Действия',
      width: '110px',
      render: (apartment) => {
        const current = apartment.intercomRoom ?? '';
        const value = draft[apartment.id] ?? current;
        const changed = value.trim() !== current.trim();
        return (
          <span className={styles.actions}>
            {changed ? (
              <Button
                compact
                loading={savingId === apartment.id}
                onClick={() => void handleSave(apartment.id, current)}
              >
                Сохранить
              </Button>
            ) : (
              <span className={styles.saved} aria-label={current ? 'Номер задан' : undefined}>
                {current ? '✓' : ''}
              </span>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Квартиры и панель</h1>
          <p className={pageStyles.pageSubtitle}>
            Какой номер набирает вызывная панель, когда звонят в квартиру
          </p>
        </div>
        {buildingId && (
          <Button variant="secondary" loading={filling} onClick={() => void handleAutofill()}>
            Подставить номера квартир
          </Button>
        )}
      </div>

      {notice && (
        <Alert
          variant={notice.ok ? 'success' : 'danger'}
          className={styles.notice}
        >
          {notice.text}
        </Alert>
      )}

      <p className={styles.hint}>
        В настройках панели это называется «комната». Обычно номер совпадает с номером квартиры —
        тогда нажмите «Подставить номера квартир». Если монтажник задал другую нумерацию,
        впишите вручную: в одном доме два одинаковых номера невозможны. Нажмите номер
        помещения, чтобы указать тип и площадь.
      </p>

      <div className={styles.toolbar}>
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Поиск по номеру квартиры"
          filters={[
            {
              id: 'building',
              label: 'Дом',
              value: buildingId ?? '',
              options: buildings.items.map((building) => ({
                value: building.id,
                label: building.addressText,
              })),
              onChange: (value) => {
                setSelectedBuildingId(value || null);
                setDraft({});
                setNotice(null);
              },
            },
          ]}
          resultCount={apartments.loading || apartments.error ? undefined : apartments.items.length}
          onReset={resetFilters}
        />
      </div>

      {buildings.loading || apartments.loading ? (
        <CenteredSpinner label="Загружаем квартиры" />
      ) : buildings.error ? (
        <Alert variant="danger" title="Не удалось загрузить дома">
          {buildings.error}
        </Alert>
      ) : !buildingId ? (
        <EmptyState
          title="Нет домов"
          description="Сначала добавьте дом и квартиры — тогда здесь можно будет задать номера."
        />
      ) : (
        <>
          {withoutRoom > 0 && (
            <p className={styles.counter}>
              Без номера: {withoutRoom}. Пока номер не задан, звонок в квартиру не придёт.
            </p>
          )}
          <DataTable
            columns={columns}
            rows={apartments.items}
            getRowKey={(apartment) => apartment.id}
            density="compact"
            ariaLabel="Квартиры и номера на панели"
            empty={
              <EmptyState
                title="Квартир не найдено"
                description="Измените запрос или выберите другой дом."
              />
            }
          />
        </>
      )}

      {editing && editForm && (
        <Drawer
          title={`Помещение ${editing.number}`}
          onClose={() => {
            setEditing(null);
            setEditForm(null);
          }}
        >
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveDetails();
            }}
          >
            <Select
              label="Тип помещения"
              value={editForm.kind}
              onChange={(event) => setEditForm({ ...editForm, kind: event.target.value })}
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
                value={editForm.rooms}
                onChange={(event) => setEditForm({ ...editForm, rooms: event.target.value })}
              />
              <Field
                label="Площадь, м²"
                type="number"
                min={0.01}
                step={0.01}
                value={editForm.areaTotal}
                onChange={(event) => setEditForm({ ...editForm, areaTotal: event.target.value })}
              />
            </div>

            <Select
              label="Статус"
              value={editForm.status}
              onChange={(event) =>
                setEditForm({ ...editForm, status: event.target.value as 'active' | 'archived' })
              }
            >
              <option value="active">Активно</option>
              <option value="archived">Архив</option>
            </Select>

            {editError && <Alert variant="danger">{editError}</Alert>}

            <div className={styles.formActions}>
              <Button type="submit" loading={editSaving}>
                Сохранить
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setEditForm(null);
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
