import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Button } from '@ui/Button';
import { Field } from '@ui/Field';
import { useAuth } from '@shared/authContext';
import { normalizePhone } from '@shared/format';
import styles from './LoginPage.module.css';

/** Минимальная длина пароля — то же правило, что в схеме сервера. */
const MIN_PASSWORD = 8;

/**
 * Регистрация жителя.
 *
 * Согласие на обработку персональных данных — обязательное условие (152-ФЗ),
 * и галочка НЕ предустановлена: согласие по умолчанию согласием не является.
 * Факт согласия сервер пишет в аудит с версией текста.
 *
 * После регистрации человек уже авторизован (сервер сразу выдаёт сессию),
 * но без привязки к квартире создавать заявки не может — ведём на привязку.
 */
export function RegisterPage() {
  const { status, register, authError, isSubmitting } = useAuth();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);

  // Приводим номер к +7XXXXXXXXXX ещё до проверки: иначе «8-923…» и «923…»
  // будут выглядеть как ошибка, хотя человек ввёл правильный номер.
  const phoneNormalized = normalizePhone(phone);
  const phoneInvalid = !/^\+7\d{10}$/.test(phoneNormalized);
  const emailInvalid = email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const passwordMismatch = passwordRepeat.length > 0 && password !== passwordRepeat;
  const nameInvalid = fullName.trim().length < 2;

  const canSubmit =
    !nameInvalid &&
    !phoneInvalid &&
    !emailInvalid &&
    password.length >= MIN_PASSWORD &&
    password === passwordRepeat &&
    consent;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (!canSubmit) return;

    await register({
      fullName: fullName.trim(),
      phone: phoneNormalized,
      ...(email.trim() ? { email: email.trim() } : {}),
      password,
    });
  };

  // Регистрация прошла — уводим на привязку квартиры. При ошибке status
  // остаётся 'anonymous', и человек видит текст ошибки на форме.
  if (status === 'authenticated') {
    return <Navigate to="/binding" replace />;
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          liviti
        </div>
        <p className={styles.tagline}>Регистрация жителя</p>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <Field
            label="ФИО"
            type="text"
            autoComplete="name"
            placeholder="Иванов Иван Иванович"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            error={touched && nameInvalid ? 'Укажите имя' : null}
          />

          <Field
            label="Телефон"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+79000000000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            // Приводим к +7XXXXXXXXXX, когда человек закончил ввод
            onBlur={() => setPhone(normalizePhone(phone))}
            error={
              touched && phoneInvalid
                ? 'Формат +7XXXXXXXXXX, например +79001234567'
                : null
            }
            hint="Можно 8…, +7… или 9… — приведём к +7XXXXXXXXXX"
          />

          <Field
            label="E-mail (необязательно)"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={touched && emailInvalid ? 'Проверьте адрес' : null}
          />

          <Field
            label="Пароль"
            type="password"
            autoComplete="new-password"
            placeholder="Не короче 8 символов"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={
              touched && passwordTooShort
                ? `Пароль должен быть не короче ${MIN_PASSWORD} символов`
                : null
            }
          />

          <Field
            label="Пароль ещё раз"
            type="password"
            autoComplete="new-password"
            placeholder="Повторите пароль"
            value={passwordRepeat}
            onChange={(e) => setPasswordRepeat(e.target.value)}
            // Показываем несовпадение сразу, как только человек начал повторять:
            // ждать нажатия «Зарегистрироваться» — поздно и раздражает
            error={passwordMismatch ? 'Пароли пока не совпадают' : null}
          />

          {/* Согласие на обработку ПДн: обязательное, не предустановлено */}
          <label
            className={[
              styles.consent,
              consent ? styles.consentChecked : '',
              touched && !consent ? styles.consentInvalid : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <input
              type="checkbox"
              className={styles.consentBox}
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span className={styles.consentText}>
              <strong>Согласен на обработку персональных данных</strong> — ФИО, телефона
              и адреса. Нужно для работы с обращениями в управляющую компанию. Без согласия
              регистрация невозможна.
            </span>
          </label>

          {touched && !consent && (
            <p className={styles.formError} role="alert">
              Без согласия на обработку персональных данных регистрация невозможна
            </p>
          )}

          {authError && (
            <p className={styles.formError} role="alert">
              {authError}
            </p>
          )}

          <Button
            type="submit"
            block
            loading={isSubmitting}
            disabled={isSubmitting || (touched && !canSubmit)}
          >
            {isSubmitting ? 'Создаём аккаунт…' : 'Зарегистрироваться'}
          </Button>
        </form>

        <p className={styles.switchLine}>
          Уже есть аккаунт?{' '}
          <Link to="/login" className={styles.switchLink}>
            Войти
          </Link>
        </p>

        <p className={styles.hint}>
          После регистрации нужно указать квартиру — управляющая компания подтвердит
          привязку, и тогда можно будет создавать заявки.
        </p>
      </div>
    </div>
  );
}
