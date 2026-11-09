import { useEffect, useState, type FormEvent } from 'react';
import { Alert } from '@ui/Alert';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { Card } from '@ui/Card';
import { Field } from '@ui/Field';
import { api, ApiError } from '@shared/api';
import { useAuth } from '@shared/authContext';
import { formatPhone, formatSnils } from '@shared/format';
import { ROLE_LABELS } from '@shared/roles';
import styles from './ProfilePage.module.css';
import pageStyles from './pages.module.css';

const BINDING_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает подтверждения',
  confirmed: 'Подтверждена',
  rejected: 'Отклонена',
};

const BINDING_STATUS_VARIANTS: Record<
  string,
  'warning' | 'success' | 'danger'
> = {
  pending: 'warning',
  confirmed: 'success',
  rejected: 'danger',
};

/**
 * Демонстрационные начисления.
 *
 * Вымышленные, как и остальные демо-данные стенда. Нужны, чтобы показать,
 * как будет выглядеть финансовый блок; живая интеграция с биллингом —
 * отдельный этап. Когда появится API, эти константы заменятся запросом.
 */


/** Профиль: личные данные (дозаполнение) и финансы. */
export function ProfilePage() {
  const { user, roles, tenant, bindings, refreshUser, logout } = useAuth();

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [birthDate, setBirthDate] = useState(user?.birthDate ?? '');
  const [snils, setSnils] = useState(user?.snils ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Блок «Финансы» открывается по ссылке с главной (/#finance)
  useEffect(() => {
    if (window.location.hash === '#finance') {
      document.getElementById('finance')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Заполненность профиля: почта и дата рождения необязательны, но без них
  // житель не получит уведомлений и поздравлений — поэтому предлагаем.
  const missing: string[] = [];
  if (!user?.email) missing.push('e-mail');
  if (!user?.birthDate) missing.push('дата рождения');

  const startEditing = () => {
    setFullName(user?.fullName ?? '');
    setEmail(user?.email ?? '');
    setBirthDate(user?.birthDate ?? '');
    setSnils(user?.snils ?? '');
    setError(null);
    setSaved(false);
    setEditing(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch('/auth/me', {
        fullName: fullName.trim(),
        email: email.trim(),
        birthDate: birthDate,
        snils: snils,
      });
      await refreshUser();
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить профиль');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError('Новый пароль должен быть не короче 8 символов');
      return;
    }
    if (newPassword !== passwordRepeat) {
      setPasswordError('Пароли не совпадают');
      return;
    }

    setPasswordBusy(true);
    try {
      await api.post('/auth/password/change', {
        currentPassword,
        newPassword,
      });
      // Сервер уже закрыл все сессии и снял refresh-cookie.
      await logout();
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Не удалось сменить пароль');
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleLogoutAll = async () => {
    if (!window.confirm('Выйти на всех устройствах? Текущая сессия тоже закроется.')) return;
    try {
      await api.post('/auth/logout-all', {});
    } finally {
      await logout();
    }
  };

  return (
    <>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Профиль</h1>
          <p className={pageStyles.pageSubtitle}>Ваши данные и доступ</p>
        </div>
      </div>

      {!editing && missing.length > 0 && (
        <Alert variant="warning" className={styles.alert}>
          <span>
            Профиль заполнен не полностью: не указаны {missing.join(' и ')}. Это нужно
            для уведомлений о заявках и начислениях.
          </span>
          <div className={styles.alertAction}>
            <Button variant="secondary" compact onClick={startEditing}>
              Дозаполнить профиль
            </Button>
          </div>
        </Alert>
      )}

      <Card>
        <div className={styles.row}>
          <span className={styles.label}>ФИО</span>
          <span className={styles.value}>{user?.fullName ?? '—'}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Телефон</span>
          <span className={styles.value}>{formatPhone(user?.phone)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>E-mail</span>
          <span className={styles.value}>{user?.email ?? '—'}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Дата рождения</span>
          <span className={styles.value}>
            {user?.birthDate ? formatBirthDate(user.birthDate) : '—'}
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>СНИЛС</span>
          <span className={styles.value}>{user?.snils ? formatSnils(user.snils) : '—'}</span>
        </div>
        {tenant && (
          <div className={styles.row}>
            <span className={styles.label}>Управляющая компания</span>
            <span className={styles.value}>{tenant.name}</span>
          </div>
        )}
        <div className={styles.row}>
          <span className={styles.label}>Роли</span>
          <span className={styles.value}>
            {roles.map((role) => (
              <Badge key={role} variant="info">
                {ROLE_LABELS[role] ?? role}
              </Badge>
            ))}
          </span>
        </div>

        {!editing && (
          <div className={[styles.formActions, styles.spaced].join(' ')}>
            <Button variant="secondary" compact onClick={startEditing}>
              Изменить данные
            </Button>
          </div>
        )}

        {editing && (
          <form className={styles.form} onSubmit={handleSubmit}>
            <Field
              label="ФИО"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иванов Иван Иванович"
              autoComplete="name"
            />
            <Field
              label="E-mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ivanov@example.ru"
              autoComplete="email"
              hint="Нужен для уведомлений и квитанций"
            />
            <Field
              label="Дата рождения"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              hint="Необязательно. Нужна для поздравлений и возрастных правил сервисов"
            />

            <Field
              label="СНИЛС"
              value={snils}
              onChange={(e) => setSnils(e.target.value)}
              placeholder="123-456-789 01"
              hint="Необязательно. Нужен, чтобы управляющая компания могла сверить вас с реестром собственников и подтвердить привязку без ручной проверки"
            />

            {error && <Alert variant="danger">{error}</Alert>}

            <div className={styles.formActions}>
              <Button type="submit" loading={saving}>
                Сохранить
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Отмена
              </Button>
            </div>
          </form>
        )}

        {saved && !editing && <Alert variant="success" className={styles.alert}>Данные сохранены</Alert>}
      </Card>

      {bindings.length > 0 && (
        <section className={styles.section}>
          <h2 className={pageStyles.sectionTitle}>Привязка к квартире</h2>
          {bindings.map((binding) => (
            <Card key={binding.id} className={styles.binding}>
              <div className={styles.bindingInfo}>
                <span>
                  {binding.addressText}, кв. {binding.apartmentNumber}
                </span>
                <span className={styles.bindingMeta}>
                  {binding.kind === 'apartment' ? 'Квартира' : 'Нежилое помещение'}
                  {binding.areaTotal ? ` · ${Number(binding.areaTotal).toLocaleString('ru-RU')} м²` : ''}
                  {binding.rooms != null ? ` · ${binding.rooms} комн.` : ''}
                  {binding.entranceNumber != null ? ` · подъезд ${binding.entranceNumber}` : ''}
                  {binding.floorNumber != null ? ` · этаж ${binding.floorNumber}` : ''}
                  {' · '}
                  {binding.roleInApartment === 'owner'
                    ? 'собственник'
                    : binding.roleInApartment === 'renter'
                      ? 'арендатор'
                      : 'представитель'}
                </span>
              </div>
              <Badge variant={BINDING_STATUS_VARIANTS[binding.status] ?? 'neutral'}>
                {BINDING_STATUS_LABELS[binding.status] ?? binding.status}
              </Badge>
            </Card>
          ))}
        </section>
      )}

      <section className={styles.section}>
        <h2 className={pageStyles.sectionTitle}>Безопасность</h2>
        <Card>
          <div className={styles.row}>
            <span className={styles.label}>Пароль</span>
            <span className={styles.value}>••••••••</span>
          </div>
          <p className={styles.hint}>
            Смена пароля закроет все активные сессии — на телефоне, планшете и компьютере.
          </p>

          {!passwordOpen ? (
            <div className={[styles.formActions, styles.spaced].join(' ')}>
              <Button variant="secondary" compact onClick={() => setPasswordOpen(true)}>
                Сменить пароль
              </Button>
              <Button variant="ghost" compact onClick={() => void handleLogoutAll()}>
                Выйти на всех устройствах
              </Button>
            </div>
          ) : (
            <form className={styles.form} onSubmit={handlePasswordChange}>
              <Field
                label="Текущий пароль"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
              <Field
                label="Новый пароль"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                hint="Не короче 8 символов"
              />
              <Field
                label="Повторите новый пароль"
                type="password"
                autoComplete="new-password"
                value={passwordRepeat}
                onChange={(event) => setPasswordRepeat(event.target.value)}
              />
              {passwordError && <Alert variant="danger">{passwordError}</Alert>}
              <div className={styles.formActions}>
                <Button type="submit" loading={passwordBusy}>
                  Сменить пароль
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setPasswordOpen(false);
                    setPasswordError(null);
                  }}
                >
                  Отмена
                </Button>
              </div>
            </form>
          )}
        </Card>
      </section>
    </>
  );
}

/** «1990-05-14» → «14.05.1990»: в профиле привычнее российский формат. */
function formatBirthDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}
