import { useState } from 'react';
import { Alert } from '@ui/Alert';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { Card } from '@ui/Card';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { Field } from '@ui/Field';
import { api, ApiError } from '@shared/api';
import { useAuth } from '@shared/authContext';
import { useStaffAccounts } from '@shared/useUtilities';
import { roleLabel } from '@shared/roles';
import pageStyles from './pages.module.css';
import styles from './StaffPage.module.css';

const UK_ROLES = ['uk_admin', 'uk_manager', 'dispatcher', 'executor'] as const;

export function StaffPage() {
  const { hasPermission, user } = useAuth();
  const staff = useStaffAccounts();
  const canManage = hasPermission('staff.roles.assign');

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [position, setPosition] = useState('');
  const [roles, setRoles] = useState<string[]>(['executor']);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});

  const toggleRole = (code: string) =>
    setRoles((prev) =>
      prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code],
    );

  const create = async () => {
    setNotice(null);
    setSaving(true);
    try {
      await api.post('/staff', {
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        password,
        position: position.trim(),
        roles,
      });
      setFullName('');
      setPhone('');
      setEmail('');
      setPassword('');
      setPosition('');
      setRoles(['executor']);
      setNotice({ ok: true, text: 'Сотрудник добавлен' });
      staff.reload();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Не удалось добавить сотрудника',
      });
    } finally {
      setSaving(false);
    }
  };

  const saveRoles = async (id: string) => {
    try {
      await api.patch(`/staff/${id}`, { roles: drafts[id] ?? [] });
      setNotice({ ok: true, text: 'Роли обновлены' });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      staff.reload();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Не удалось обновить роли',
      });
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    if (!window.confirm(isActive ? 'Деактивировать сотрудника?' : 'Вернуть сотрудника?')) return;
    try {
      await api.patch(`/staff/${id}`, { isActive });
      setNotice({ ok: true, text: isActive ? 'Сотрудник деактивирован' : 'Сотрудник активен' });
      staff.reload();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Не удалось изменить статус',
      });
    }
  };

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Сотрудники</h1>
          <p className={pageStyles.pageSubtitle}>Команда УК, роли и доступ к кабинету</p>
        </div>
      </div>

      {notice && (
        <Alert variant={notice.ok ? 'success' : 'danger'} className={styles.notice}>
          {notice.text}
        </Alert>
      )}

      {canManage && (
        <Card className={styles.formCard}>
          <h2 className={styles.formTitle}>Добавить сотрудника</h2>
          <div className={styles.formGrid}>
            <Field
              label="ФИО"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
            <Field
              label="Телефон"
              type="tel"
              placeholder="+79001234567"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
            <Field
              label="E-mail"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Field
              label="Пароль"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Field
              label="Должность"
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            />
          </div>
          <div className={styles.roles}>
            <span className={styles.rolesLabel}>Роли</span>
            {UK_ROLES.map((code) => (
              <label key={code} className={styles.check}>
                <input
                  type="checkbox"
                  checked={roles.includes(code)}
                  onChange={() => toggleRole(code)}
                />
                {roleLabel(code)}
              </label>
            ))}
          </div>
          <Button loading={saving} onClick={() => void create()}>
            Добавить
          </Button>
        </Card>
      )}

      {staff.loading ? (
        <CenteredSpinner label="Загружаем сотрудников" />
      ) : staff.error ? (
        <p className={pageStyles.loadError}>{staff.error}</p>
      ) : staff.items.length === 0 ? (
        <EmptyState title="Сотрудников пока нет" description="Добавьте первого сотрудника." />
      ) : (
        <div className={styles.list}>
          {staff.items.map((member) => {
            const currentRoles = drafts[member.id] ?? member.roles;
            return (
              <Card key={member.id} className={styles.card}>
                <div className={styles.head}>
                  <div>
                    <h2 className={styles.name}>
                      {member.fullName}
                      {member.id === user?.id && <span className={styles.self}>это вы</span>}
                    </h2>
                    <div className={styles.meta}>
                      {member.position && <span>{member.position}</span>}
                      {member.phone && <span>{member.phone}</span>}
                      {member.email && <span>{member.email}</span>}
                    </div>
                  </div>
                  <Badge variant={member.isActive ? 'success' : 'neutral'}>
                    {member.isActive ? 'Активен' : 'Деактивирован'}
                  </Badge>
                </div>

                {canManage ? (
                  <>
                    <div className={styles.roles}>
                      {UK_ROLES.map((code) => (
                        <label key={code} className={styles.check}>
                          <input
                            type="checkbox"
                            checked={currentRoles.includes(code)}
                            onChange={() =>
                              setDrafts((prev) => {
                                const next = currentRoles.includes(code)
                                  ? currentRoles.filter((role) => role !== code)
                                  : [...currentRoles, code];
                                return { ...prev, [member.id]: next };
                              })
                            }
                          />
                          {roleLabel(code)}
                        </label>
                      ))}
                    </div>
                    <div className={styles.actions}>
                      <Button
                        variant="secondary"
                        compact
                        disabled={!drafts[member.id]}
                        onClick={() => void saveRoles(member.id)}
                      >
                        Сохранить роли
                      </Button>
                      {member.id !== user?.id && (
                        <Button
                          variant="ghost"
                          compact
                          onClick={() => void toggleActive(member.id, member.isActive)}
                        >
                          {member.isActive ? 'Деактивировать' : 'Вернуть'}
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className={styles.roles}>
                    {member.roles.map((code) => (
                      <Badge key={code} variant="neutral">
                        {roleLabel(code)}
                      </Badge>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
