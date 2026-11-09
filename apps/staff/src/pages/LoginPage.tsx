/**
 * Вход в кабинет УК.
 *
 * Отличия от входа жителя: нет регистрации и нет гостевого доступа — сотрудника
 * создаёт администратор УК. Телефон или e-mail — одно поле, сервер сам
 * определяет, что это.
 *
 * Дальше здесь появится второй фактор для диспетчеров и админов: у них доступ
 * к данным сотен квартир, и одного пароля мало.
 */
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@ui/Button';
import { Logo } from '@ui/Logo';
import { Field } from '@ui/Field';
import { api } from '@shared/api';
import { useAuth } from '@shared/authContext';
import { normalizePhone } from '@shared/format';
import styles from './LoginPage.module.css';

/**
 * Подсказка с демонстрационными входами.
 *
 * Пароль стенда не должен лежать в репозитории: значение задаётся при сборке
 * переменной VITE_DEMO_LOGINS. Если переменная не задана, блок не показывается.
 */
/** Главный сайт: с формы входа ведём именно на него, а не на текущий домен */
const LANDING_URL = (import.meta.env.VITE_LANDING_URL as string | undefined) ?? 'https://liviti.ru/';

const DEMO_HINT = (import.meta.env.VITE_DEMO_LOGINS as string | undefined)?.trim() ?? '';
const DEMO_LINES = DEMO_HINT.length > 0 ? DEMO_HINT.split('\n') : [];

export function LoginPage() {
  const { status, roles, login, authError, authErrorCode, isSubmitting } = useAuth();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [tenantName, setTenantName] = useState<string | null>(null);

  // Поддомен УК: на dom-service.liviti.ru показываем, чей это кабинет.
  // На uk.liviti.ru и локально остаётся нейтральная подпись.
  useEffect(() => {
    const host = window.location.hostname.toLowerCase();
    const suffix = '.liviti.ru';
    if (!host.endsWith(suffix)) return;

    const slug = host.slice(0, -suffix.length);
    if (!slug || slug.includes('.') || ['app', 'uk', 'www'].includes(slug)) return;

    let cancelled = false;
    api
      .get<{ name: string }>(`/public/tenant?slug=${encodeURIComponent(slug)}`)
      .then((data) => {
        if (!cancelled) setTenantName(data.name);
      })
      .catch(() => {
        // Поддомен без УК — обычный вход, без ошибки на экране
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Сервер просит код только после верного пароля: до этого мы не знаем,
  // включён ли у человека второй фактор, и не показываем лишнее поле
  const needTotp = authErrorCode === 'TOTP_REQUIRED' || authErrorCode === 'INVALID_TOTP';

  // После входа всегда в инбокс: исполнителя сервер сам отправит в «Мои задания»,
  // если инбокс ему недоступен
  useEffect(() => {
    if (status === 'authenticated') {
      const route = roles.includes('executor') && !roles.includes('dispatcher') ? '/my' : '/inbox';
      navigate(route, { replace: true });
    }
  }, [status, roles, navigate]);

  if (status === 'authenticated') {
    return <Navigate to="/inbox" replace />;
  }

  const emptyFields = identifier.trim() === '' || password === '';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (emptyFields) return;
    await login(normalizePhone(identifier), password, needTotp ? totpCode.trim() : undefined);
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <Logo size="lg" />
        </div>
        <p className={styles.tagline}>
          {tenantName ? `Кабинет ${tenantName}` : 'Кабинет управляющей компании'}
        </p>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <Field
            label="Телефон или e-mail"
            type="text"
            inputMode="tel"
            autoComplete="username"
            autoFocus
            placeholder="+79000000001"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            onBlur={() => setIdentifier(normalizePhone(identifier))}
            error={touched && identifier.trim() === '' ? 'Введите телефон или e-mail' : null}
          />

          <Field
            label="Пароль"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={touched && password === '' ? 'Введите пароль' : null}
          />

          {needTotp && (
            <Field
              label="Код из приложения"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              autoFocus
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))}
              hint="6 цифр из Google Authenticator, Authy или другого приложения"
            />
          )}

          {authError && (
            <p className={styles.formError} role="alert">
              {authError}
            </p>
          )}

          <Button type="submit" block loading={isSubmitting} disabled={isSubmitting}>
            {isSubmitting ? 'Входим…' : 'Войти'}
          </Button>
        </form>

        <p className={styles.hint}>
          Учётные записи сотрудников создаёт администратор управляющей компании.
        </p>

        {DEMO_LINES.length > 0 && (
          <p className={styles.hint}>
            <span className={styles.hintTitle}>Демонстрационные входы</span>
            {DEMO_LINES.map((line, index) => (
              <Fragment key={index}>
                {index > 0 && <br />}
                {line}
              </Fragment>
            ))}
          </p>
        )}

        <p className={styles.homeLine}>
          <a className={styles.homeLink} href={LANDING_URL}>
            На главную сайта
          </a>
        </p>
      </div>
    </div>
  );
}
