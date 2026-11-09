/**
 * Профиль сотрудника УК.
 *
 * Зачем отдельный экран: раньше сотрудник видел только имя и организацию
 * в шапке. Он не знал, какие права ему выдали, не мог сменить пароль и не
 * понимал, куда придёт второй фактор. Здесь всё это собрано в одном месте.
 *
 * Права показывает сервер (`/auth/me`), подписи и группировка — общий
 * каталог `@shared/permissions`: сырые коды вроде `ticket.view.all`
 * сотруднику ничего не говорят.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@ui/Alert';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { Card } from '@ui/Card';
import { Field } from '@ui/Field';
import { api, ApiError } from '@shared/api';
import { useAuth } from '@shared/authContext';
import { formatPhone, initials } from '@shared/format';
import { groupGrantedPermissions } from '@shared/permissions';
import { roleLabel } from '@shared/roles';
import styles from './ProfilePage.module.css';
import pageStyles from './pages.module.css';

type TwoFactorMode = 'idle' | 'setup' | 'codes' | 'disable';

export function ProfilePage() {
  const { user, roles, permissions, tenant, twoFactor, refreshUser, logout } = useAuth();

  // ─── Редактирование личных данных ──────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // ─── Смена пароля ──────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // ─── Второй фактор ─────────────────────────────────────────────────────
  const [twoFactorMode, setTwoFactorMode] = useState<TwoFactorMode>('idle');
  const [setupSecret, setSetupSecret] = useState('');
  const [setupUri, setSetupUri] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [codeCopied, setCodeCopied] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disableLoading, setDisableLoading] = useState(false);

  const permissionGroups = groupGrantedPermissions(permissions);
  // Секрет показываем группами по 4: так его проще диктовать и сверять
  const formattedSecret = setupSecret.replace(/(.{4})/g, '$1 ').trim();

  const startEditing = () => {
    setFullName(user?.fullName ?? '');
    setEmail(user?.email ?? '');
    setSaveError(null);
    setSaved(false);
    setEditing(true);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await api.patch('/auth/me', { fullName: fullName.trim(), email: email.trim() });
      // Имя и почта приходят в /auth/me — без перечитывания шапка останется старой
      await refreshUser();
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Не удалось сохранить профиль');
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
    if (newPassword !== repeatPassword) {
      setPasswordError('Пароли не совпадают');
      return;
    }

    setChanging(true);
    try {
      await api.post('/auth/password/change', { currentPassword, newPassword });
      // Сервер закрыл все сеансы. Продолжать с текущим токеном нечестно:
      // пароль изменён — значит, вход должен быть заново.
      await logout();
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Не удалось сменить пароль');
    } finally {
      setChanging(false);
    }
  };

  // ─── Второй фактор ──────────────────────────────────────────────────────
  const startTwoFactorSetup = async () => {
    setSetupError(null);
    setSetupLoading(true);
    try {
      const data = await api.post<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup');
      setSetupSecret(data.secret);
      setSetupUri(data.otpauthUrl);
      setSetupCode('');
      setTwoFactorMode('setup');
    } catch (err) {
      setSetupError(err instanceof ApiError ? err.message : 'Не удалось начать настройку');
    } finally {
      setSetupLoading(false);
    }
  };

  const confirmTwoFactor = async (event: FormEvent) => {
    event.preventDefault();
    setSetupError(null);
    setSetupLoading(true);
    try {
      const data = await api.post<{ enabled: boolean; backupCodes: string[] }>(
        '/auth/2fa/enable',
        { code: setupCode.trim() },
      );
      setBackupCodes(data.backupCodes);
      setTwoFactorMode('codes');
      await refreshUser();
    } catch (err) {
      setSetupError(err instanceof ApiError ? err.message : 'Не удалось включить второй фактор');
    } finally {
      setSetupLoading(false);
    }
  };

  const finishTwoFactorSetup = () => {
    setTwoFactorMode('idle');
    setSetupSecret('');
    setSetupUri('');
    setSetupCode('');
    setBackupCodes([]);
    setSetupError(null);
  };

  const disableTwoFactor = async (event: FormEvent) => {
    event.preventDefault();
    setDisableError(null);
    setDisableLoading(true);
    try {
      await api.post('/auth/2fa/disable', {
        password: disablePassword,
        code: disableCode.trim(),
      });
      await refreshUser();
      setTwoFactorMode('idle');
      setDisablePassword('');
      setDisableCode('');
    } catch (err) {
      setDisableError(err instanceof ApiError ? err.message : 'Не удалось отключить второй фактор');
    } finally {
      setDisableLoading(false);
    }
  };

  const copySetupSecret = async () => {
    try {
      await navigator.clipboard.writeText(setupSecret);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Буфер обмена недоступен (http, старый браузер) — секрет виден на экране
    }
  };

  return (
    <>
      <div className={pageStyles.pageHeader}>
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            {initials(user?.fullName ?? '')}
          </span>
          <div>
            <h1 className={pageStyles.pageTitle}>Профиль</h1>
            <p className={pageStyles.pageSubtitle}>
              {tenant ? `Сотрудник ${tenant.name}` : 'Сотрудник управляющей компании'}
            </p>
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        {/* ─── Личные данные ────────────────────────────────────────────── */}
        <Card>
          <h2 className={pageStyles.sectionTitle}>Данные</h2>

          {!editing ? (
            <>
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

              <div className={styles.formActions}>
                <Button variant="secondary" compact onClick={startEditing}>
                  Изменить данные
                </Button>
              </div>
              {saved && (
                <Alert variant="success" className={styles.alert}>
                  Данные сохранены
                </Alert>
              )}
            </>
          ) : (
            <form className={styles.form} onSubmit={handleSave}>
              <Field
                label="ФИО"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
              />
              <Field
                label="E-mail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                hint="Нужен для уведомлений; можно очистить"
              />
              {saveError && (
                <Alert variant="danger" className={styles.alert}>
                  {saveError}
                </Alert>
              )}
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
        </Card>

        {/* ─── Организация и роли ───────────────────────────────────────── */}
        <Card>
          <h2 className={pageStyles.sectionTitle}>Организация</h2>
          <div className={styles.row}>
            <span className={styles.label}>Управляющая компания</span>
            <span className={styles.value}>{tenant?.name ?? '—'}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Должность</span>
            <span className={styles.value}>{tenant?.position ?? '—'}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Роли</span>
            <span className={styles.value}>
              {roles.length > 0
                ? roles.map((role) => (
                    <Badge key={role} variant="info">
                      {roleLabel(role)}
                    </Badge>
                  ))
                : '—'}
            </span>
          </div>
          <p className={styles.hint}>
            Должность и роли назначает администратор УК — изменить их самостоятельно нельзя.
          </p>
        </Card>

        {/* ─── Права ────────────────────────────────────────────────────── */}
        <Card className={styles.cardWide}>
          <h2 className={pageStyles.sectionTitle}>Права доступа</h2>
          <p className={styles.hint}>
            Это действия, которые разрешены вашим ролям. Набор прав проверяется на сервере
            при каждом запросе, поэтому изменения вступают в силу сразу.
          </p>

          {permissionGroups.length === 0 ? (
            <p className={styles.hint}>Права не назначены — обратитесь к администратору УК.</p>
          ) : (
            <div className={styles.permissionGroups}>
              {permissionGroups.map((group) => (
                <div key={group.title} className={styles.permissionGroup}>
                  <h3 className={styles.permissionGroupTitle}>{group.title}</h3>
                  <ul className={styles.permissionList}>
                    {group.items.map((item) => (
                      <li key={item.code} className={styles.permissionItem}>
                        {item.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ─── Безопасность ─────────────────────────────────────────────── */}
        <Card className={styles.cardWide}>
          <h2 className={pageStyles.sectionTitle}>Безопасность</h2>

          <div className={styles.securityGrid}>
            <div>
              <h3 className={styles.subtitle}>Смена пароля</h3>
              <p className={styles.hint}>
                После смены пароля все сеансы закроются — нужно будет войти заново.
              </p>
              <form className={styles.form} onSubmit={handlePasswordChange}>
                <Field
                  label="Текущий пароль"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <Field
                  label="Новый пароль"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  hint="Не короче 8 символов"
                />
                <Field
                  label="Повторите новый пароль"
                  type="password"
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                  autoComplete="new-password"
                />
                {passwordError && (
                  <Alert variant="danger" className={styles.alert}>
                    {passwordError}
                  </Alert>
                )}
                <div className={styles.formActions}>
                  <Button type="submit" loading={changing}>
                    Сменить пароль
                  </Button>
                </div>
              </form>
            </div>

            {/* Второй фактор: включается только после проверки кода
                из приложения, поэтому «настроить» — это два шага. */}
            <div className={styles.twoFactor}>
              <div>
                <h3 className={styles.subtitle}>Второй фактор</h3>
                <p className={styles.hint}>
                  {twoFactor?.enabled
                    ? 'Вход по одноразовому коду включён: при входе понадобится код из приложения.'
                    : 'Вход по одноразовому коду (TOTP) для диспетчеров и администраторов.'}
                </p>
                {!twoFactor?.enabled && twoFactor?.required && (
                  <Alert variant="warning" className={styles.alert}>
                    Ваша роль требует второй фактор — подключите его.
                  </Alert>
                )}
                {twoFactor?.enabled && (
                  <p className={styles.hint}>
                    Резервных кодов осталось: {twoFactor.backupCodesLeft}.
                  </p>
                )}
                {setupError && twoFactorMode === 'idle' && (
                  <Alert variant="danger" className={styles.alert}>
                    {setupError}
                  </Alert>
                )}
              </div>
              <div className={styles.twoFactorActions}>
                <Badge variant={twoFactor?.enabled ? 'success' : 'neutral'}>
                  {twoFactor?.enabled ? 'Подключён' : 'Не подключён'}
                </Badge>
                {twoFactorMode === 'idle' &&
                  (twoFactor?.enabled ? (
                    <Button variant="ghost" compact onClick={() => setTwoFactorMode('disable')}>
                      Отключить
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      compact
                      loading={setupLoading}
                      onClick={() => void startTwoFactorSetup()}
                    >
                      Подключить
                    </Button>
                  ))}
              </div>
            </div>
          </div>

          {twoFactorMode === 'setup' && (
            <div className={styles.setupPanel}>
              <h3 className={styles.subtitle}>Подключение второго фактора</h3>
              <ol className={styles.steps}>
                <li>
                  Добавьте ключ в приложение-аутентификатор (Google Authenticator,
                  Authy, 1Password).
                  <div className={styles.secretRow}>
                    <code className={styles.secret}>{formattedSecret}</code>
                    <Button variant="ghost" compact onClick={() => void copySetupSecret()}>
                      {codeCopied ? 'Скопировано' : 'Скопировать'}
                    </Button>
                    <a className={styles.otpauthLink} href={setupUri}>
                      Открыть в приложении
                    </a>
                  </div>
                </li>
                <li>
                  Введите код, который покажет приложение.
                  <form className={styles.form} onSubmit={confirmTwoFactor}>
                    <Field
                      label="Код из приложения"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="123456"
                      value={setupCode}
                      onChange={(event) => setSetupCode(event.target.value.replace(/\D/g, ''))}
                    />
                    {setupError && (
                      <Alert variant="danger" className={styles.alert}>
                        {setupError}
                      </Alert>
                    )}
                    <div className={styles.formActions}>
                      <Button type="submit" loading={setupLoading}>
                        Включить
                      </Button>
                      <Button variant="ghost" onClick={finishTwoFactorSetup}>
                        Отмена
                      </Button>
                    </div>
                  </form>
                </li>
              </ol>
            </div>
          )}

          {twoFactorMode === 'codes' && (
            <div className={styles.setupPanel}>
              <h3 className={styles.subtitle}>Второй фактор включён</h3>
              <p className={styles.hint}>
                Сохраните резервные коды. Каждый срабатывает один раз; повторно
                они не показываются.
              </p>
              <div className={styles.backupCodes}>
                {backupCodes.map((code) => (
                  <code key={code}>{code}</code>
                ))}
              </div>
              <div className={styles.formActions}>
                <Button onClick={finishTwoFactorSetup}>Я сохранил коды</Button>
              </div>
            </div>
          )}

          {twoFactorMode === 'disable' && (
            <div className={styles.setupPanel}>
              <h3 className={styles.subtitle}>Отключение второго фактора</h3>
              <p className={styles.hint}>
                Подтвердите паролем и действующим кодом — из приложения или резервным.
              </p>
              <form className={styles.form} onSubmit={disableTwoFactor}>
                <Field
                  label="Пароль"
                  type="password"
                  autoComplete="current-password"
                  value={disablePassword}
                  onChange={(event) => setDisablePassword(event.target.value)}
                />
                <Field
                  label="Код из приложения или резервный"
                  autoComplete="one-time-code"
                  value={disableCode}
                  onChange={(event) => setDisableCode(event.target.value)}
                />
                {disableError && (
                  <Alert variant="danger" className={styles.alert}>
                    {disableError}
                  </Alert>
                )}
                <div className={styles.formActions}>
                  <Button type="submit" loading={disableLoading}>
                    Отключить
                  </Button>
                  <Button variant="ghost" onClick={() => setTwoFactorMode('idle')}>
                    Отмена
                  </Button>
                </div>
              </form>
            </div>
          )}
        </Card>
      </div>

      <section className={styles.adminSection}>
        <h2 className={pageStyles.sectionTitle}>Управление УК</h2>
        <div className={styles.adminLinks}>
          {permissions.includes('staff.view') && (
            <Link className={styles.adminLink} to="/staff">
              <span>Сотрудники</span>
              <span className={styles.adminHint}>Роли и доступ команды</span>
            </Link>
          )}
          {permissions.includes('building.view') && (
            <Link className={styles.adminLink} to="/contacts">
              <span>Полезные телефоны</span>
              <span className={styles.adminHint}>Что видит житель</span>
            </Link>
          )}
          {permissions.includes('audit.view') && (
            <Link className={styles.adminLink} to="/audit">
              <span>Журнал действий</span>
              <span className={styles.adminHint}>Кто что изменил</span>
            </Link>
          )}
          {permissions.includes('report.view') && (
            <Link className={styles.adminLink} to="/reports">
              <span>Отчёты</span>
              <span className={styles.adminHint}>Просрочки и нагрузка</span>
            </Link>
          )}
        </div>
      </section>
    </>
  );
}
