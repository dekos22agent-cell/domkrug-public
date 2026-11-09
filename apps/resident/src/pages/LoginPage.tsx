import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@ui/Button';
import { Logo } from '@ui/Logo';
import { Field } from '@ui/Field';
import { useAuth } from '@shared/authContext';
import { normalizePhone } from '@shared/format';
import { defaultRouteFor } from '@shared/roles';
import { WrongAppNotice } from '@ui/WrongAppNotice';
import styles from './LoginPage.module.css';

/**
 * Подсказка с демонстрационными входами.
 *
 * Почему не в коде: пароль демо-стенда не должен лежать в репозитории —
 * иначе он попадает и в публичную сборку, и в историю Git. Значение
 * задаётся при сборке переменной VITE_DEMO_LOGINS; строки разделяются \n.
 *
 * Если переменная не задана, блок не показывается вовсе: на боевом
 * стенде подсказки с паролями быть не должно.
 */
/** Главный сайт: с формы входа ведём именно на него, а не на текущий домен */
const LANDING_URL = (import.meta.env.VITE_LANDING_URL as string | undefined) ?? 'https://liviti.ru/';

const DEMO_HINT = (import.meta.env.VITE_DEMO_LOGINS as string | undefined)?.trim() ?? '';
const DEMO_LINES = DEMO_HINT.length > 0 ? DEMO_HINT.split('\n') : [];

// Кабинет УК — отдельное приложение. Пока поддомены не подняты, он живёт
// на /uk/ главного домена.
const STAFF_URL = (import.meta.env.VITE_STAFF_URL as string | undefined) ?? '/uk/';

/** Маршруты, которые есть только в кабинете УК. */
const STAFF_ROUTES = ['/inbox', '/my', '/platform'];

/**
 * Экран входа.
 *
 * Вход по телефону или e-mail — один input: сервер сам определяет, что это
 * (`findUserByIdentifier`). Разделять на два поля значило бы спрашивать у
 * человека то, что он и так знает.
 */
export function LoginPage() {
  const { status, roles, login, logout, authError, isSubmitting } = useAuth();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  // После успешного входа уводим по роли. Следим за status, а не за успехом
  // login(): провайдер обновляет состояние асинхронно.
  const staffRoute = defaultRouteFor(roles);
  const isStaffAccount = STAFF_ROUTES.includes(staffRoute);

  useEffect(() => {
    // Сотрудника УК не отправляем в /inbox: в приложении жителя такого
    // раздела нет, и человек попадал на 404 сразу после входа
    if (status === 'authenticated' && !isStaffAccount) {
      navigate(staffRoute, { replace: true });
    }
  }, [status, staffRoute, isStaffAccount, navigate]);

  // Сотрудник УК вошёл в приложение жителя — объясняем и ведём в кабинет
  if (status === 'authenticated' && isStaffAccount) {
    return (
      <WrongAppNotice
        title="Это приложение жителя"
        description="Вы вошли как сотрудник управляющей компании. Заявки, привязки и квартиры — в кабинете УК, это отдельное приложение."
        actionLabel="Открыть кабинет УК"
        actionHref={STAFF_URL}
        onLogout={() => void logout()}
      />
    );
  }

  // Уже вошли — на форме входа делать нечего
  if (status === 'authenticated') {
    return <Navigate to={staffRoute} replace />;
  }

  const emptyFields = identifier.trim() === '' || password === '';

  // Приводим номер к +7XXXXXXXXXX: люди пишут 8-923…, 7923…, 923… — сервер
  // ищет пользователя по точному значению телефона и иначе не найдёт.
  // E-mail normalizePhone не трогает.
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (emptyFields) return;
    await login(normalizePhone(identifier), password);
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <Logo size="lg" />
        </div>
        <p className={styles.tagline}>Цифровая среда для современной жизни</p>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <Field
            label="Телефон или e-mail"
            type="text"
            inputMode="tel"
            autoComplete="username"
            autoFocus
            placeholder="+79000000001"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            // Приводим номер, когда человек закончил ввод: переформатировать
            // на каждом нажатии — значит переставлять курсор под рукой.
            onBlur={() => setIdentifier(normalizePhone(identifier))}
            error={touched && identifier.trim() === '' ? 'Введите телефон или e-mail' : null}
          />

          <Field
            label="Пароль"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={touched && password === '' ? 'Введите пароль' : null}
          />

          {authError && (
            <p className={styles.formError} role="alert">
              {authError}
            </p>
          )}

          <Button type="submit" block loading={isSubmitting} disabled={isSubmitting}>
            {isSubmitting ? 'Входим…' : 'Войти'}
          </Button>
        </form>

        <p className={styles.switchLine}>
          Впервые здесь?{' '}
          <Link to="/register" className={styles.switchLink}>
            Зарегистрироваться
          </Link>
        </p>

        {/* Вход по коду — для тех, кому не нужен аккаунт: строитель, курьер,
            гость. Ни телефона, ни пароля, ни согласия на обработку ПДн */}
        <p className={styles.switchLine}>
          Есть код доступа?{' '}
          <Link to="/guest" className={styles.switchLink}>
            Войти по коду
          </Link>
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
