/**
 * Схемы валидации для модуля авторизации.
 *
 * Валидация живёт рядом с маршрутами, а не в контроллере: тогда правила
 * видны до чтения логики, и одно и то же правило нельзя случайно
 * продублировать по-разному в двух местах.
 */
import { z } from 'zod';

/** Телефон в нормализованном виде: +7 и 10 цифр. */
const phoneSchema = z
  .string()
  .regex(/^\+7\d{10}$/, 'Телефон в формате +7XXXXXXXXXX, например +79001234567');

const emailSchema = z.string().trim().toLowerCase().email('Некорректный e-mail').max(254);

const passwordSchema = z
  .string()
  .min(8, 'Пароль должен быть не короче 8 символов')
  .max(128, 'Пароль слишком длинный');

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Укажите имя').max(200),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
    // Согласие на обработку ПДн обязательно (152-ФЗ) и не может быть «по умолчанию»
    consentAccepted: z
      .boolean()
      .refine((v) => v === true, 'Без согласия на обработку персональных данных регистрация невозможна'),
  })
  .refine((v) => Boolean(v.email) || Boolean(v.phone), {
    message: 'Укажите телефон или e-mail',
    path: ['phone'],
  });

export const loginSchema = z.object({
  // Может быть телефоном или e-mail — клиент не обязан угадывать
  identifier: z.string().trim().min(3, 'Укажите телефон или e-mail').max(254),
  password: z.string().min(1, 'Введите пароль'),
  /**
   * Куда входит человек: приложение жителя или кабинет УК.
   *
   * Нужен, чтобы учётка УК не открывала приложение жителя и наоборот.
   * Ответ на «не то приложение» такой же, как на неверный пароль:
   * иначе по форме входа можно узнать, кто где работает.
   */
  audience: z.enum(['resident', 'staff']).optional(),
  /**
   * Второй фактор. Поля необязательные: они нужны только тем, у кого TOTP
   * включён. Если включён, а поля нет — сервер отвечает TOTP_REQUIRED,
   * и клиент показывает ввод кода.
   */
  totpCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Код из приложения — 6 цифр')
    .optional(),
  /** Резервный код на случай потерянного телефона. */
  backupCode: z.string().trim().min(4, 'Слишком короткий код').max(20).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Введите текущий пароль'),
  newPassword: passwordSchema,
});

/**
 * Включение второго фактора: код из приложения, который пользователь
 * только что увидел. Одной настройки приложения мало — код доказывает,
 * что секрет действительно попал в аутентификатор.
 */
export const enableTwoFactorSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Код из приложения — 6 цифр'),
});

/**
 * Отключение защищает паролем и действующим кодом: одной сессии мало,
 * иначе украденный токен снимал бы второй фактор.
 */
export const disableTwoFactorSchema = z.object({
  password: z.string().min(1, 'Введите пароль'),
  code: z
    .string()
    .trim()
    .min(4, 'Введите код из приложения или резервный код')
    .max(20),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Дозаполнение профиля.
 *
 * Все поля необязательны: житель заполняет то, что хочет. Пустая строка
 * для email означает «убрать почту» — приводим к null.
 */
export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Укажите имя').max(200).optional(),
  email: z
    .union([z.string().trim().toLowerCase().email('Некорректный e-mail').max(254), z.literal('')])
    .optional(),
  // Дата рождения: строка YYYY-MM-DD, не в будущем и не раньше 1900 года
  birthDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД'), z.literal('')])
    .optional(),
  /**
   * СНИЛС, 11 цифр. Необязателен: нужен, чтобы УК могла сверить жителя
   * с реестром собственников и подтвердить привязку автоматически.
   * Контрольная сумма проверяется отдельно — одной длины мало.
   */
  snils: z.string().trim().max(20).optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
