/**
 * Фотографии заявок.
 *
 * Файл грузится multipart-ом на конкретную заявку и потом отдаётся только
 * через API с токеном — публичных ссылок нет. Поэтому в интерфейсе картинка
 * получается как blob: <img> не умеет отправлять заголовок Authorization.
 *
 * Адрес зависит от роли: у жителя `/resident/tickets/...` (только свои заявки),
 * у сотрудника УК `/tickets/...` (вся УК или назначенные). Если перепутать,
 * диспетчер увидит заявку без фотографий: на чужую жительский адрес отвечает 404.
 */
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { TicketAttachment } from './types';

function basePath(isStaff: boolean): string {
  return isStaff ? '/tickets' : '/resident/tickets';
}

export interface UploadOptions {
  /** Фото проблемы, фотоотчёт или файл комментария */
  kind?: 'request_photo' | 'result_photo' | 'comment_file' | 'document';
  /** К какому комментарию приложен файл */
  commentId?: string | null;
  /** Сотрудник УК грузит по своему адресу */
  isStaff?: boolean;
}

/** Загрузить один файл. Ошибку возвращаем текстом: её показываем под формой. */
export async function uploadAttachment(
  ticketId: string,
  file: File,
  options: UploadOptions = {},
): Promise<{ ok: boolean; message: string; item?: TicketAttachment }> {
  const form = new FormData();
  form.append('file', file);

  const query = new URLSearchParams();
  if (options.kind) query.set('kind', options.kind);
  if (options.commentId) query.set('commentId', options.commentId);
  const suffix = query.toString() ? `?${query.toString()}` : '';

  try {
    const item = await api.postForm<TicketAttachment>(
      `${basePath(options.isStaff ?? false)}/${ticketId}/attachments${suffix}`,
      form,
    );
    return { ok: true, message: 'Файл загружен', item };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    return { ok: false, message: 'Не удалось загрузить файл' };
  }
}

export function useTicketAttachments(ticketId: string | undefined, isStaff = false) {
  const [items, setItems] = useState<TicketAttachment[]>([]);
  const [loading, setLoading] = useState(Boolean(ticketId));

  useEffect(() => {
    if (!ticketId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get<{ items: TicketAttachment[] }>(
          `${basePath(isStaff)}/${ticketId}/attachments`,
        );
        if (!cancelled) setItems(response.items);
      } catch {
        // Вложения — не причина ломать экран заявки
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticketId, isStaff]);

  return { items, loading };
}

/**
 * Адрес картинки для показа.
 *
 * Скачиваем с токеном и делаем blob-URL: обычный <img> не передаёт заголовок
 * авторизации, а публичные ссылки на файлы мы принципиально не выдаём.
 */
export function useAttachmentPreview(
  ticketId: string | undefined,
  attachment: TicketAttachment | undefined,
  isStaff = false,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!ticketId || !attachment) return;

    let cancelled = false;
    // Ссылку держим в замыкании эффекта: так её можно освободить при уборке,
    // не трогая состояние (иначе React ругается справедливо)
    let objectUrl: string | null = null;

    (async () => {
      try {
        const blob = await api.getBlob(
          `${basePath(isStaff)}/${ticketId}/attachments/${attachment.id}`,
        );
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setUrl(null);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ticketId, attachment, isStaff]);

  return url;
}
