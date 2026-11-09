import { useState } from 'react';
import { Alert } from '@ui/Alert';
import { Button } from '@ui/Button';
import { Card } from '@ui/Card';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { Field } from '@ui/Field';
import { Select } from '@ui/Select';
import { api, ApiError } from '@shared/api';
import { useAuth } from '@shared/authContext';
import { useBuildings } from '@shared/useStructure';
import { useStaffContacts } from '@shared/useUtilities';
import type { StaffContact } from '@shared/types';
import pageStyles from './pages.module.css';
import styles from './ContactsPage.module.css';

const KINDS: { value: StaffContact['kind']; label: string }[] = [
  { value: 'uk', label: 'Управляющая компания' },
  { value: 'district', label: 'Участковый' },
  { value: 'provider', label: 'Провайдер / связь' },
  { value: 'clinic', label: 'Медицина' },
  { value: 'emergency', label: 'Аварийная служба' },
  { value: 'other', label: 'Другое' },
];

const emptyForm = {
  kind: 'uk' as StaffContact['kind'],
  name: '',
  phone: '',
  note: '',
  buildingId: '',
  sortOrder: '0',
};

export function ContactsPage() {
  const { hasPermission } = useAuth();
  const contacts = useStaffContacts();
  const buildings = useBuildings();
  const canManage = hasPermission('building.manage');
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<StaffContact | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const startEdit = (contact: StaffContact) => {
    setEditing(contact);
    setForm({
      kind: contact.kind,
      name: contact.name,
      phone: contact.phone,
      note: contact.note ?? '',
      buildingId: contact.buildingId ?? '',
      sortOrder: String(contact.sortOrder),
    });
  };

  const reset = () => {
    setEditing(null);
    setForm(emptyForm);
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const payload = {
        kind: form.kind,
        name: form.name.trim(),
        phone: form.phone.trim(),
        note: form.note.trim() || null,
        buildingId: form.buildingId || null,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (editing) {
        await api.patch(`/contacts/${editing.id}`, payload);
      } else {
        await api.post('/contacts', payload);
      }
      setNotice({ ok: true, text: editing ? 'Телефон обновлён' : 'Телефон добавлен' });
      reset();
      contacts.reload();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Не удалось сохранить телефон',
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Удалить этот телефон?')) return;
    try {
      await api.delete(`/contacts/${id}`);
      contacts.reload();
      setNotice({ ok: true, text: 'Телефон удалён' });
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Не удалось удалить телефон',
      });
    }
  };

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Полезные телефоны</h1>
          <p className={pageStyles.pageSubtitle}>Что житель видит в разделе «Экстренно»</p>
        </div>
      </div>

      {notice && (
        <Alert variant={notice.ok ? 'success' : 'danger'} className={styles.notice}>
          {notice.text}
        </Alert>
      )}

      {canManage && (
        <Card className={styles.formCard}>
          <h2 className={styles.formTitle}>
            {editing ? 'Редактировать телефон' : 'Добавить телефон'}
          </h2>
          <div className={styles.formGrid}>
            <Select
              label="Тип"
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value as StaffContact['kind'] })}
            >
              {KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </Select>
            <Field
              label="Название"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <Field
              label="Телефон"
              type="tel"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
            <Field
              label="Примечание"
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
            />
            <Select
              label="Дом"
              value={form.buildingId}
              onChange={(event) => setForm({ ...form, buildingId: event.target.value })}
            >
              <option value="">Вся УК</option>
              {buildings.items.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.addressText}
                </option>
              ))}
            </Select>
            <Field
              label="Порядок"
              type="number"
              value={form.sortOrder}
              onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            />
          </div>
          <div className={styles.actions}>
            <Button loading={saving} onClick={() => void save()}>
              {editing ? 'Сохранить' : 'Добавить'}
            </Button>
            {editing && (
              <Button variant="ghost" onClick={reset}>
                Отмена
              </Button>
            )}
          </div>
        </Card>
      )}

      {contacts.loading ? (
        <CenteredSpinner label="Загружаем телефоны" />
      ) : contacts.error ? (
        <p className={pageStyles.loadError}>{contacts.error}</p>
      ) : contacts.items.length === 0 ? (
        <EmptyState title="Телефонов пока нет" description="Добавьте первый контакт для жителей." />
      ) : (
        <div className={styles.list}>
          {contacts.items.map((contact) => (
            <Card key={contact.id} className={styles.card}>
              <div className={styles.info}>
                <strong>{contact.name}</strong>
                <span className={styles.meta}>
                  {KINDS.find((kind) => kind.value === contact.kind)?.label ?? contact.kind}
                  {contact.buildingAddress ? ` · ${contact.buildingAddress}` : ' · вся УК'}
                  {contact.note ? ` · ${contact.note}` : ''}
                </span>
                <a className={styles.phone} href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>
                  {contact.phone}
                </a>
              </div>
              {canManage && (
                <div className={styles.actions}>
                  <Button variant="secondary" compact onClick={() => startEdit(contact)}>
                    Изменить
                  </Button>
                  <Button variant="ghost" compact onClick={() => void remove(contact.id)}>
                    Удалить
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
