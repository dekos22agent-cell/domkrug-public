/**
 * Хеширование паролей.
 *
 * Используется scrypt из стандартной библиотеки Node.js:
 *   - не нужна нативная зависимость (а значит, нет проблем со сборкой на Windows);
 *   - scrypt рекомендован OWASP как стойкий к перебору на GPU;
 *   - параметры хранятся в самой строке хеша, поэтому их можно поднять
 *     в будущем без сброса паролей у пользователей.
 *
 * Формат: scrypt$N$r$p$salt_base64$key_base64
 */
import { randomBytes, scrypt, scryptSync, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

const SCRYPT_N = 16_384; // стоимость CPU/памяти
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Асинхронная версия для HTTP-путей.
 *
 * scryptSync блокирует весь Node на время вычисления: при входе или проверке
 * гостевого кода один запрос останавливает остальные. Эти функции не блокируют
 * event loop; синхронные оставлены для seed/тестов, где это не важно.
 */
export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;

  const [scheme, nRaw, rRaw, pRaw, saltB64, keyB64] = parts;
  if (scheme !== 'scrypt' || !nRaw || !rRaw || !pRaw || !saltB64 || !keyB64) {
    return false;
  }

  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  if (expected.length === 0) return false;

  const actual = await scryptAsync(password, salt, expected.length, { N, r, p });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;

  const [scheme, nRaw, rRaw, pRaw, saltB64, keyB64] = parts;
  if (scheme !== 'scrypt' || !nRaw || !rRaw || !pRaw || !saltB64 || !keyB64) {
    return false;
  }

  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  if (expected.length === 0) return false;

  const actual = scryptSync(password, salt, expected.length, { N, r, p });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
