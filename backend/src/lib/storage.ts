/**
 * Хранилище файлов.
 *
 * На пилоте файлы лежат на диске сервера: MinIO в Docker на этом железе
 * не поднимается (см. DECISIONS), а S3-совместимое хранилище ради фотографий
 * к заявке — лишняя сущность. Абстракция оставлена, чтобы переезд на S3 был
 * заменой одной реализации, а не переписыванием модулей.
 *
 * Ключ объекта — не публичный URL: файл отдаётся только через API после
 * проверки прав. Поэтому `storage_key` никогда не попадает в браузер.
 */
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { config } from '../config.js';

/** Разрешённые типы: фото с телефона и документ. Видео сюда не пускаем. */
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];

const EXTENSIONS: Record<AllowedMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Тип файла определяем по первым байтам, а не по расширению.
 *
 * Расширению верить нельзя: `photo.jpg` может оказаться чем угодно,
 * а браузер потом отрисует это как картинку.
 */
export function detectMime(buffer: Buffer): AllowedMime | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  // RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') {
    return 'application/pdf';
  }
  return null;
}

export function extensionFor(mime: AllowedMime): string {
  return EXTENSIONS[mime];
}

/** Абсолютный путь по ключу. Защита от «../../»: ключ не может выйти за корень. */
export function resolveKey(storageKey: string): string {
  const root = normalize(config.storage.dir);
  const target = normalize(join(root, storageKey));
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error('Недопустимый путь файла');
  }
  return target;
}

export async function saveObject(storageKey: string, data: Buffer): Promise<void> {
  const path = resolveKey(storageKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

export async function objectExists(storageKey: string): Promise<boolean> {
  try {
    await stat(resolveKey(storageKey));
    return true;
  } catch {
    return false;
  }
}

export async function deleteObject(storageKey: string): Promise<void> {
  try {
    await unlink(resolveKey(storageKey));
  } catch {
    // Файла уже нет — для вызывающего это успех
  }
}

/** Поток для отдачи файла. Метаданные берём из базы, а не из диска. */
export function readObject(storageKey: string) {
  return createReadStream(resolveKey(storageKey));
}
