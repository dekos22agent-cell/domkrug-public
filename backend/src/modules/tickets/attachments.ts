/**
 * Файлы заявок: фото проблемы и документы.
 *
 * Файл отдаётся только через API после проверки прав — публичных ссылок нет.
 * Тип определяется по первым байтам, а не по расширению: `photo.jpg`
 * с чужим содержимым иначе отрисовалось бы как картинка.
 */
import { randomUUID } from 'node:crypto';
import { pool } from '../../db/pool.js';
import { config } from '../../config.js';
import {
  ALLOWED_MIME,
  detectMime,
  extensionFor,
  objectExists,
  readObject,
  saveObject,
} from '../../lib/storage.js';

export type AttachmentKind = 'request_photo' | 'result_photo' | 'comment_file' | 'document';

export interface AttachmentItem {
  id: string;
  kind: AttachmentKind;
  /** Комментарий, к которому приложен файл (для фото в комментариях) */
  commentId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /** Адрес для показа: сам файл требует авторизации */
  url: string;
}

interface AttachmentRow {
  id: string;
  kind: AttachmentKind;
  comment_id: string | null;
  original_name: string;
  mime_type: string;
  size_bytes: string;
  created_at: string;
}

function toItem(row: AttachmentRow, ticketId: string): AttachmentItem {
  return {
    id: row.id,
    kind: row.kind,
    commentId: row.comment_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
    url: `/resident/tickets/${ticketId}/attachments/${row.id}`,
  };
}

/** Можно ли этому человеку видеть заявку (житель: своя или по его квартире). */
export async function canResidentSeeTicket(
  userId: string,
  ticketId: string,
): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM tickets t
      WHERE t.id = $1
        AND t.deleted_at IS NULL
        AND (t.created_by = $2
             OR t.apartment_id IN (
                  SELECT apartment_id FROM apartment_rights
                   WHERE user_id = $2 AND can_tickets
                ))
      LIMIT 1`,
    [ticketId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

export interface SaveAttachmentInput {
  tenantId: string;
  ticketId: string;
  userId: string;
  kind: AttachmentKind;
  originalName: string;
  buffer: Buffer;
  /** Если файл приложен к комментарию, а не к заявке целиком */
  commentId?: string | null;
}

export type SaveAttachmentResult =
  | { ok: true; item: AttachmentItem }
  | { ok: false; code: 'TOO_LARGE' | 'UNSUPPORTED_MIME'; message: string };

export async function saveAttachment(input: SaveAttachmentInput): Promise<SaveAttachmentResult> {
  if (input.buffer.length > config.storage.maxFileBytes) {
    return {
      ok: false,
      code: 'TOO_LARGE',
      message: `Файл больше ${Math.round(config.storage.maxFileBytes / (1024 * 1024))} МБ`,
    };
  }

  // УК берём из самой заявки: у жителя auth.tenantId пустой, а вложение
  // должно принадлежать той УК, что обслуживает дом
  const ticketTenant = await pool.query<{ tenant_id: string }>(
    'SELECT tenant_id FROM tickets WHERE id = $1',
    [input.ticketId],
  );
  const tenantId = ticketTenant.rows[0]?.tenant_id;
  if (!tenantId) {
    return { ok: false, code: 'UNSUPPORTED_MIME', message: 'Заявка не найдена' };
  }

  const mime = detectMime(input.buffer);
  if (!mime || !ALLOWED_MIME.includes(mime)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_MIME',
      message: 'Поддерживаются фото JPEG, PNG, WebP и PDF',
    };
  }

  // Файл из комментария должен принадлежать этой же заявке: иначе можно
  // приложить снимок к чужой переписке, зная только её id
  if (input.commentId) {
    const comment = await pool.query(
      'SELECT 1 FROM ticket_comments WHERE id = $1 AND ticket_id = $2',
      [input.commentId, input.ticketId],
    );
    if ((comment.rowCount ?? 0) === 0) {
      return { ok: false, code: 'UNSUPPORTED_MIME', message: 'Комментарий не найден' };
    }
  }

  // Ключ строим сами: имя файла от клиента в путь не попадает
  const storageKey = `tickets/${tenantId}/${input.ticketId}/${randomUUID()}.${extensionFor(mime)}`;
  await saveObject(storageKey, input.buffer);

  const inserted = await pool.query<AttachmentRow>(
    `INSERT INTO attachments
       (tenant_id, ticket_id, comment_id, kind, storage_key, original_name, mime_type,
        size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, kind, comment_id, original_name, mime_type,
               size_bytes::text AS size_bytes, created_at::text AS created_at`,
    [
      tenantId,
      input.ticketId,
      input.commentId ?? null,
      input.kind,
      storageKey,
      // Имя обрезаем: длинные имена ломают вёрстку и мешают скачивать
      input.originalName.slice(0, 200),
      mime,
      input.buffer.length,
      input.userId,
    ],
  );

  const row = inserted.rows[0];
  if (!row) throw new Error('Вложение не сохранено');
  return { ok: true, item: toItem(row, input.ticketId) };
}

export async function listAttachments(ticketId: string): Promise<AttachmentItem[]> {
  const res = await pool.query<AttachmentRow>(
    `SELECT id, kind, comment_id, original_name, mime_type,
            size_bytes::text AS size_bytes, created_at::text AS created_at
       FROM attachments
      WHERE ticket_id = $1 AND deleted_at IS NULL
      ORDER BY created_at`,
    [ticketId],
  );
  return res.rows.map((row) => toItem(row, ticketId));
}

export interface AttachmentFile {
  stream: ReturnType<typeof readObject>;
  mimeType: string;
  originalName: string;
}

/** Файл для отдачи. Права проверяются маршрутом до вызова этой функции. */
export async function openAttachment(
  ticketId: string,
  attachmentId: string,
): Promise<AttachmentFile | null> {
  const res = await pool.query<{
    storage_key: string;
    mime_type: string;
    original_name: string;
  }>(
    `SELECT storage_key, mime_type, original_name
       FROM attachments
      WHERE id = $1 AND ticket_id = $2 AND deleted_at IS NULL`,
    [attachmentId, ticketId],
  );

  const row = res.rows[0];
  if (!row) return null;
  if (!(await objectExists(row.storage_key))) return null;

  return {
    stream: readObject(row.storage_key),
    mimeType: row.mime_type,
    originalName: row.original_name,
  };
}

/**
 * Может ли сотрудник видеть заявку этой УК.
 *
 * Проверять нужно отдельно от прав: право «видеть все заявки» действует
 * внутри своей УК. Без этой проверки администратор другой компании мог бы
 * открыть файл, зная только UUID заявки.
 *
 * `canViewAll = false` — исполнитель: видит только назначенные ему заявки.
 */
export async function canStaffSeeTicket(
  userId: string,
  tenantId: string | null,
  ticketId: string,
  canViewAll: boolean,
): Promise<boolean> {
  if (!tenantId) return false;

  const res = await pool.query(
    `SELECT 1 FROM tickets t
      WHERE t.id = $1
        AND t.deleted_at IS NULL
        AND t.tenant_id = $2
        AND ($3::boolean = true OR t.assigned_to = $4)
      LIMIT 1`,
    [ticketId, tenantId, canViewAll, userId],
  );
  return (res.rowCount ?? 0) > 0;
}
