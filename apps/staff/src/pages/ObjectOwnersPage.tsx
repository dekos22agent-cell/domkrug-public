import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '@ui/Alert';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { DataTable, type DataTableColumn } from '@ui/DataTable';
import { Drawer } from '@ui/Drawer';
import { EmptyState } from '@ui/EmptyState';
import { Field } from '@ui/Field';
import { Modal } from '@ui/Modal';
import { Select } from '@ui/Select';
import { CenteredSpinner } from '@ui/Spinner';
import { TextArea } from '@ui/TextArea';
import { ApiError } from '@shared/api';
import { useAuth } from '@shared/authContext';
import {
  createOwner,
  removeOwner,
  updateOwner,
  useApartments,
  useBuildingPassport,
  useOwners,
} from '@shared/useStructure';
import type { OwnerListItem, OwnerRole, SaveOwnerInput } from '@shared/types';
import { objectKindLabel } from '@shared/objectKind';
import { ObjectTabs } from './ObjectTabs';
import pageStyles from './pages.module.css';
import styles from './ObjectOwnersPage.module.css';

interface OwnerForm {
  apartmentId: string;
  fullName: string;
  phone: string;
  email: string;
  role: OwnerRole;
  sharePercent: string;
  validFrom: string;
  validTo: string;
  notes: string;
}

function today(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function emptyForm(apartmentId = ''): OwnerForm {
  return {
    apartmentId,
    fullName: '',
    phone: '',
    email: '',
    role: 'owner',
    sharePercent: '100',
    validFrom: today(),
    validTo: '',
    notes: '',
  };
}

function toForm(owner: OwnerListItem): OwnerForm {
  return {
    apartmentId: owner.apartmentId,
    fullName: owner.fullName,
    phone: owner.phone ?? '',
    email: owner.email ?? '',
    role: owner.role,
    sharePercent: String(Number(owner.sharePercent)),
    validFrom: owner.validFrom,
    validTo: owner.validTo ?? '',
    notes: owner.notes ?? '',
  };
}

function formatDate(input: string | null): string {
  if (!input) return '—';
  const date = new Date(`${input}T00:00:00`);
  return Number.isNaN(date.getTime()) ? input : date.toLocaleDateString('ru-RU');
}

function formatShare(input: string): string {
  const number = Number(input);
  return Number.isFinite(number)
    ? `${number.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`
    : input;
}

function toInput(form: OwnerForm): SaveOwnerInput {
  return {
    fullName: form.fullName.trim(),
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    notes: form.notes.trim() || null,
    role: form.role,
    sharePercent: Number(form.sharePercent.replace(',', '.')),
    validFrom: form.validFrom,
    validTo: form.validTo || null,
  };
}

/** Собственники и доли: отдельный реестр, не смешанный с доступом в приложение. */
export function ObjectOwnersPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('apartment.manage');
  const object = useBuildingPassport(id ?? null);
  const owners = useOwners(id ?? null);
  const apartments = useApartments(id ?? null);

  const [form, setForm] = useState<OwnerForm | null>(null);
  const [editing, setEditing] = useState<OwnerListItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [removing, setRemoving] = useState<OwnerListItem | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const update = (key: keyof OwnerForm) => (next: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: next } : prev));
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(apartments.items[0]?.id ?? ''));
    setFormError(null);
    setNotice(null);
  };

  const openEdit = (owner: OwnerListItem) => {
    setEditing(owner);
    setForm(toForm(owner));
    setFormError(null);
    setNotice(null);
  };

  const handleSave = async () => {
    if (!form || !id) return;
    if (!form.apartmentId) {
      setFormError('Выберите помещение');
      return;
    }
    if (form.fullName.trim().length < 2) {
      setFormError('Укажите ФИО собственника');
      return;
    }
    const share = Number(form.sharePercent.replace(',', '.'));
    if (!Number.isFinite(share) || share <= 0 || share > 100) {
      setFormError('Доля должна быть от 0,01 до 100%');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await updateOwner(id, editing.ownershipId, toInput(form));
        setNotice({ ok: true, text: 'Данные собственника обновлены' });
      } else {
        await createOwner(id, form.apartmentId, toInput(form));
        setNotice({ ok: true, text: 'Собственник добавлен' });
      }
      setForm(null);
      setEditing(null);
      owners.reload();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'Не удалось сохранить собственника',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!removing || !id) return;
    setRemoveBusy(true);
    try {
      await removeOwner(id, removing.ownershipId);
      setRemoving(null);
      setNotice({ ok: true, text: 'Собственник убран из помещения' });
      owners.reload();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Не удалось убрать собственника',
      });
    } finally {
      setRemoveBusy(false);
    }
  };

  if (object.loading) return <CenteredSpinner label="Загружаем собственников" />;
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

  const columns: DataTableColumn<OwnerListItem>[] = [
    {
      key: 'apartment',
      header: 'Помещение',
      width: '130px',
      render: (owner) => <span className={styles.apartment}>кв. {owner.apartmentNumber}</span>,
    },
    {
      key: 'owner',
      header: 'Собственник',
      render: (owner) => (
        <span className={styles.owner}>
          <strong>{owner.fullName}</strong>
          <span className={styles.contact}>
            {[owner.phone, owner.email].filter(Boolean).join(' · ') || 'Контакты не указаны'}
          </span>
        </span>
      ),
    },
    {
      key: 'share',
      header: 'Доля',
      width: '100px',
      render: (owner) => <span className={styles.share}>{formatShare(owner.sharePercent)}</span>,
    },
    {
      key: 'role',
      header: 'Роль',
      width: '150px',
      hideOnMobile: true,
      render: (owner) => (
        <Badge variant={owner.role === 'owner' ? 'info' : 'neutral'}>
          {owner.role === 'owner' ? 'Собственник' : 'Представитель'}
        </Badge>
      ),
    },
    {
      key: 'period',
      header: 'Период',
      width: '190px',
      hideOnMobile: true,
      render: (owner) => (
        <span className={styles.period}>
          {formatDate(owner.validFrom)} — {owner.validTo ? formatDate(owner.validTo) : 'бессрочно'}
        </span>
      ),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: '',
            width: '220px',
            render: (owner: OwnerListItem) => (
              <span className={styles.actions}>
                <Button compact variant="secondary" onClick={() => openEdit(owner)}>
                  Изменить
                </Button>
                <Button compact variant="ghost" onClick={() => setRemoving(owner)}>
                  Убрать
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className={styles.page}>
      <Link to={`/objects/${id}`} className={styles.back}>
        ← Паспорт объекта
      </Link>

      <div className={styles.header}>
        <div>
          <div className={styles.kicker}>
            <Badge variant="info">{objectKindLabel(building.objectKind)}</Badge>
            <span>{building.addressText}</span>
          </div>
          <h1 className={pageStyles.pageTitle}>Собственники</h1>
          <p className={pageStyles.pageSubtitle}>
            Физические лица, их доля и период права. Учётная запись в приложении — отдельно.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openCreate} disabled={apartments.items.length === 0}>
            Добавить собственника
          </Button>
        )}
      </div>

      {notice && (
        <Alert variant={notice.ok ? 'success' : 'danger'} className={styles.notice}>
          {notice.text}
        </Alert>
      )}

      <ObjectTabs objectId={id ?? ''} active="owners" />

      {owners.loading ? (
        <CenteredSpinner label="Загружаем реестр" />
      ) : owners.error ? (
        <p className={pageStyles.loadError}>{owners.error}</p>
      ) : owners.items.length === 0 ? (
        <EmptyState
          title="Собственников пока нет"
          description="Добавьте первого собственника и укажите его долю в помещении."
          action={
            canEdit && apartments.items.length > 0 ? (
              <Button onClick={openCreate}>Добавить собственника</Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={owners.items}
          getRowKey={(owner) => owner.ownershipId}
          density="compact"
          ariaLabel="Собственники объекта"
          onRowClick={canEdit ? openEdit : undefined}
          getRowAriaLabel={(owner) => `Изменить данные: ${owner.fullName}`}
        />
      )}

      {form && (
        <Drawer
          title={editing ? 'Изменить собственника' : 'Добавить собственника'}
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
              onChange={(event) => update('apartmentId')(event.target.value)}
              disabled={Boolean(editing)}
            >
              {apartments.items.map((apartment) => (
                <option key={apartment.id} value={apartment.id}>
                  кв. {apartment.number}
                </option>
              ))}
            </Select>

            <Field
              label="ФИО"
              value={form.fullName}
              onChange={(event) => update('fullName')(event.target.value)}
              autoComplete="name"
              required
            />

            <div className={styles.formGrid}>
              <Field
                label="Телефон"
                type="tel"
                value={form.phone}
                onChange={(event) => update('phone')(event.target.value)}
                placeholder="+7 …"
              />
              <Field
                label="E-mail"
                type="email"
                value={form.email}
                onChange={(event) => update('email')(event.target.value)}
              />
              <Select
                label="Роль"
                value={form.role}
                onChange={(event) => update('role')(event.target.value)}
              >
                <option value="owner">Собственник</option>
                <option value="representative">Представитель</option>
              </Select>
              <Field
                label="Доля, %"
                type="number"
                min={0.01}
                max={100}
                step={0.01}
                value={form.sharePercent}
                onChange={(event) => update('sharePercent')(event.target.value)}
              />
              <Field
                label="Право с"
                type="date"
                value={form.validFrom}
                onChange={(event) => update('validFrom')(event.target.value)}
                required
              />
              <Field
                label="Право до"
                type="date"
                value={form.validTo}
                onChange={(event) => update('validTo')(event.target.value)}
                hint="Пусто — бессрочно"
              />
            </div>

            <TextArea
              label="Заметки"
              rows={3}
              value={form.notes}
              onChange={(event) => update('notes')(event.target.value)}
              placeholder="Например, представитель по доверенности"
            />

            {formError && <Alert variant="danger">{formError}</Alert>}

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

      {removing && (
        <Modal title="Убрать собственника?" onClose={() => setRemoving(null)} size="sm">
          <p className={styles.removeText}>
            {removing.fullName} будет убран из помещения кв. {removing.apartmentNumber}.
            История права сохранится в архиве.
          </p>
          <div className={styles.formActions}>
            <Button variant="danger" loading={removeBusy} onClick={() => void handleRemove()}>
              Убрать
            </Button>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Отмена
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

