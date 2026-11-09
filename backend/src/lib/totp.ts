/**
 * TOTP (RFC 6238) на стандартной библиотеке Node.js.
 *
 * Почему без внешнего пакета: нужен один алгоритм, а зависимость тянет
 * обновления, lock-файл и риск на деплое. HMAC-SHA1 из `node:crypto` —
 * ровно то, что описано в RFC, и его можно проверить официальными
 * тестовыми векторами (см. totp.test.ts).
 *
 * Секрет — base32, 20 байт (160 бит): столько рекомендует RFC 4226 для HOTP.
 * Такой секрет принимают Google Authenticator, Authy, 1Password и другие.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SECRET_BYTES = 20;

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/**
 * Допуск в шагах: принимаем код предыдущего и следующего 30-секундного окна.
 * Часы телефона и сервера расходятся, а без допуска человек с точным кодом
 * получал бы «неверный код» и не понимал почему.
 */
const DEFAULT_WINDOW = 1;

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Некорректный base32-секрет');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** HOTP: HMAC-SHA1 по счётчику и динамическое усечение (RFC 4226). */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', secret).update(counterBytes).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Номер 30-секундного окна для момента времени. */
export function stepAt(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** Код для конкретного окна — нужен и в тестах, и при отладке. */
export function totpAt(secretBase32: string, step: number): string {
  return hotp(base32Decode(secretBase32), step);
}

/**
 * Проверка кода с допуском по времени.
 *
 * Сравнение через timingSafeEqual: обычное `===` на строках теоретически
 * позволяет подбирать код по времени ответа, хотя на практике это шум.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs = Date.now(),
  window = DEFAULT_WINDOW,
): boolean {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;

  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return false;
  }

  const step = stepAt(nowMs);
  for (let offset = -window; offset <= window; offset++) {
    const candidate = hotp(secret, step + offset);
    if (timingSafeEqual(Buffer.from(candidate), Buffer.from(normalized))) {
      return true;
    }
  }
  return false;
}

/**
 * Ссылка для приложения-аутентификатора.
 *
 * `issuer` — название в списке приложений, `account` — телефон или e-mail:
 * по ним человек понимает, какая это учётка, если их несколько.
 */
export function otpauthUri(input: {
  secret: string;
  account: string;
  issuer?: string;
}): string {
  const issuer = input.issuer ?? 'liviti';
  const label = `${issuer}:${input.account}`;
  const query = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}
