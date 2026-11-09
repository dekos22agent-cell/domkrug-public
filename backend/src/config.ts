/**
 * Конфигурация приложения.
 *
 * Все переменные читаются ОДИН раз при старте и валидируются через zod.
 * Если чего-то не хватает или значение неверное — приложение падает сразу
 * с понятным сообщением, а не через час в рантайме на середине запроса.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// backend/src или backend/dist → ../../.env = <repo>/.env
const rootEnvPath = path.resolve(here, '../../.env');

if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  /**
   * Интерфейс, на котором слушает API.
   *
   * По умолчанию только loopback: наружу должен смотреть Caddy, а не Node.
   * Если API слушает 0.0.0.0, `trustProxy` позволяет подделывать
   * X-Forwarded-For и обходить лимиты входа/регистрации.
   */
  APP_HOST: z.string().trim().default('127.0.0.1'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  /** Явный список origin'ов для CORS через запятую (если появится api-поддомен). */
  CORS_ORIGINS: z.string().optional(),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен (см. .env.example)'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Секрет обязателен всегда. Заглушка из .env.example отвергается ниже:
  // иначе на сервере с забытым NODE_ENV токены подделывает любой читатель репозитория.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET: минимум 32 символа'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  /**
   * Отдельный секрет для поиска гостевых кодов (HMAC).
   * Если не задан — используется JWT_SECRET (совместимость со стендом).
   */
  CODE_SECRET: z.string().min(32).optional(),

  /**
   * Отдельный ключ обратимого шифрования (коды доступа, будущие TOTP/СНИЛС).
   * Не задан — совместимость: новые данные шифруются ключом из JWT_SECRET,
   * старые (без префикса версии) читаются им же.
   */
  DATA_ENCRYPTION_KEY: z.string().min(32).optional(),

  /** Осознанное разрешение заглушки — только для локального стенда. */
  ALLOW_INSECURE_DEV_SECRET: z.enum(['true', 'false']).optional(),

  /**
   * Флаг Secure у refresh-cookie.
   *
   * По умолчанию: true в production, false в development. Флаг Secure означает,
   * что браузер отправит cookie только по HTTPS. Если сервер временно работает
   * по HTTP (пилот на голом IP без домена), cookie с этим флагом просто не
   * сохранится — вход будет «слетать» после перезагрузки страницы.
   *
   * Явное `COOKIE_SECURE=false` разрешает работу по HTTP. Это осознанный
   * компромисс для пилота: токены ходят в открытом виде, поэтому включать
   * такое можно только с тестовыми данными и только до появления домена.
   */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),

  /**
   * Домен refresh-cookie.
   *
   * Пусто — cookie привязана к текущему хосту (безопасный вариант по умолчанию).
   * `.liviti.ru` нужен, чтобы главная страница на liviti.ru видела сессию,
   * открытую на app.liviti.ru или uk.liviti.ru.
   */
  COOKIE_DOMAIN: z.string().trim().optional(),

  /**
   * Приём звонков с вызывной панели через Asterisk AMI.
   *
   * По умолчанию выключено: без настроенного Asterisk бэкенд не должен
   * стучаться в закрытый порт и засорять журнал.
   * AMI слушает только 127.0.0.1 — наружу не выставляем.
   */
  AMI_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  AMI_HOST: z.string().default('127.0.0.1'),
  AMI_PORT: z.coerce.number().int().positive().max(65535).default(5038),
  AMI_USER: z.string().optional(),
  /** Пароль. AMI_SECRET — то же самое, так его называет документация Asterisk. */
  AMI_PASSWORD: z.string().optional(),
  AMI_SECRET: z.string().optional(),

  /**
   * Звонки из браузера (WebRTC): адрес WebSocket, абонент и пароль.
   * Выдаются жителю через API, чтобы сайт мог зарегистрироваться в Asterisk.
   */
  SIP_APP_WSS: z.string().optional(),
  SIP_APP_USER: z.string().optional(),
  SIP_APP_PASSWORD: z.string().optional(),
  SIP_APP_REALM: z.string().optional(),

  /**
   * Устройство доступа (вызывная панель Hikvision, контроллер СКУД).
   *
   * Необязательные: без них приложение работает на mock-провайдере и молча
   * ничего не открывает — это нормальное состояние демо и разработки.
   * Заполняются на машине, стоящей в одной подсети с железом; в git не попадают.
   */
  ACCESS_VENDOR_HOST: z.string().optional(),
  ACCESS_VENDOR_USER: z.string().optional(),
  ACCESS_VENDOR_PASSWORD: z.string().optional(),
  /** Сколько секунд замок держится открытым (устройство этого не сообщает). */
  ACCESS_VENDOR_HOLD_SECONDS: z.coerce.number().int().positive().max(60).default(5),
  /** Таймаут запроса к устройству: панель в офисе отвечает за единицы мс. */
  ACCESS_VENDOR_TIMEOUT_MS: z.coerce.number().int().positive().max(30000).default(5000),

  /**
   * Куда складывать фото и документы заявок.
   *
   * На пилоте — каталог на диске. Позже может стать путём монтирования S3
   * или временного диска: модуль хранилища не знает, что под ним.
   */
  STORAGE_DIR: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.') || '(корень)'}: ${i.message}`)
    .join('\n');
  console.error(`\n[config] Ошибка конфигурации:\n${issues}\n`);
  console.error('[config] Скопируйте .env.example в .env и заполните значения.\n');
  process.exit(1);
}

const env = parsed.data;

// Значение из публичного .env.example — не секрет: его может подделать
// любой, кто читал репозиторий. Отвергаем, пока явно не разрешено для
// локального стенда.
const INSECURE_JWT_SECRET = 'dev-only-insecure-secret-change-me-32ch';
if (env.JWT_SECRET === INSECURE_JWT_SECRET && env.ALLOW_INSECURE_DEV_SECRET !== 'true') {
  console.error(
    '[config] JWT_SECRET совпадает с примером из .env.example. ' +
      'Сгенерируйте свой: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))".',
  );
  process.exit(1);
}

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  host: env.APP_HOST,
  port: env.APP_PORT,
  appUrl: env.APP_URL,
  corsOrigins: env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : null,
  logLevel: env.LOG_LEVEL,
  databaseUrl: env.DATABASE_URL,
  jwt: {
    secret: env.JWT_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
  },
  /** Ключ HMAC для индекса гостевых кодов; отдельный, если задан. */
  codeSecret: env.CODE_SECRET ?? env.JWT_SECRET,
  /** Ключ обратимого шифрования; отдельный, если задан. */
  dataEncryptionKey: env.DATA_ENCRYPTION_KEY ?? env.JWT_SECRET,
  /**
   * Secure-флаг refresh-cookie. По умолчанию включён в production.
   * Отключается явно через COOKIE_SECURE=false — только для HTTP-пилота.
   */
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  /**
   * Домен refresh-cookie. В production — `.liviti.ru`: иначе главная страница
   * не может показать, что человек уже вошёл в приложение или кабинет.
   * Пусто — cookie остаётся host-only.
   */
  cookieDomain: env.COOKIE_DOMAIN || undefined,
  /** Признак «работаем по HTTP в production» — для предупреждения при старте. */
  insecureHttpInProduction:
    env.NODE_ENV === 'production' && env.COOKIE_SECURE === 'false',

  /**
   * AMI (Asterisk Manager Interface) — источник событий о звонках с панели.
   * enabled включается только при заполненных учётке и пароле: иначе
   * бессмысленно подключаться и засорять журнал отказами.
   */
  ami: {
    enabled: Boolean(env.AMI_ENABLED && env.AMI_USER && (env.AMI_PASSWORD ?? env.AMI_SECRET)),
    host: env.AMI_HOST,
    port: env.AMI_PORT,
    user: env.AMI_USER ?? '',
    password: env.AMI_PASSWORD ?? env.AMI_SECRET ?? '',
  },

  /**
   * Устройство доступа. Пустой host = устройство не настроено, провайдер
   * честно откажет вместо тихого «открыто».
   */
  access: {
    host: env.ACCESS_VENDOR_HOST ?? '',
    user: env.ACCESS_VENDOR_USER ?? '',
    password: env.ACCESS_VENDOR_PASSWORD ?? '',
    holdSeconds: env.ACCESS_VENDOR_HOLD_SECONDS,
    timeoutMs: env.ACCESS_VENDOR_TIMEOUT_MS,
  },

  /**
   * Учётка для звонков из браузера (WebRTC).
   *
   * Житель открывает сайт, браузер регистрируется на нашем Asterisk по WSS и
   * получает звонок с панели — со звуком в обе стороны. Пароль один на всех
   * (стенд); на боевом объекте нужен отдельный абонент на квартиру.
   *
   * Пустой пароль = звонки из браузера выключены: сайт продолжит показывать
   * окно и открывать дверь, но разговаривать будет нельзя.
   */
  /**
   * Файлы заявок: фотографии и документы.
   *
   * Лежат на диске сервера: MinIO на этом железе не поднимается, а S3 ради
   * фотографий к заявке — лишняя сущность. Меняется через src/lib/storage.ts.
   */
  storage: {
    dir: env.STORAGE_DIR ?? './uploads',
    maxFileBytes: 10 * 1024 * 1024,
  },

  sip: {
    enabled: Boolean(env.SIP_APP_PASSWORD),
    wss: env.SIP_APP_WSS ?? 'wss://liviti.ru/ws',
    user: env.SIP_APP_USER ?? '100',
    password: env.SIP_APP_PASSWORD ?? '',
    /** Домен в SIP URI: у нас без домена, но поле обязательно в клиенте. */
    realm: env.SIP_APP_REALM ?? 'liviti.ru',
  },
} as const;
