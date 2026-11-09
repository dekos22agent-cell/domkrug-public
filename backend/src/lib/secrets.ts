/**
 * Обратимое шифрование небольших секретов приложения.
 *
 * Зачем: некоторые секреты нужны владельцу в открытом виде (код доступа,
 * чтобы продиктовать или отправить), но хранить их plaintext нельзя — дамп
 * базы разошёлся бы вместе с доступами в подъезды.
 *
 * AES-256-GCM: шифрование + аутентификация.
 *
 * Ключи:
 * - активный — DATA_ENCRYPTION_KEY, если задан, иначе JWT_SECRET;
 * - старый (без префикса версии) — всегда JWT_SECRET, чтобы после введения
 *   отдельного ключа уже сохранённые коды продолжали читаться;
 * - новые значения пишутся с префиксом `v2.`.
 *
 * Это разделяет утечку JWT и утечку данных, но не является полноценной
 * ротацией: при смене DATA_ENCRYPTION_KEY старые `v2.` значения нужно
 * перешифровать. Для TOTP/СНИЛС позже понадобится версионирование ключей.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const ACTIVE_KEY = createHash('sha256')
  .update(`access-code:${config.dataEncryptionKey}`)
  .digest();
const LEGACY_KEY = createHash('sha256').update(`access-code:${config.jwt.secret}`).digest();

const VERSION = 'v2';

export function sealSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ACTIVE_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

/** Возвращает null, если данные повреждены или ключ другой. */
export function openSecret(sealed: string | null): string | null {
  if (!sealed) return null;

  const parts = sealed.split('.');
  let key: Buffer;
  let ivPart: string;
  let tagPart: string;
  let dataPart: string;

  if (parts.length === 4 && parts[0] === VERSION) {
    key = ACTIVE_KEY;
    ivPart = parts[1] ?? '';
    tagPart = parts[2] ?? '';
    dataPart = parts[3] ?? '';
  } else if (parts.length === 3) {
    // Значения, созданные до появления версии/отдельного ключа.
    key = LEGACY_KEY;
    ivPart = parts[0] ?? '';
    tagPart = parts[1] ?? '';
    dataPart = parts[2] ?? '';
  } else {
    return null;
  }

  if (!ivPart || !tagPart || !dataPart) return null;

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
