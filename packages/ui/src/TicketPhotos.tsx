/**
 * Фотографии заявки.
 *
 * Отдельный компонент, потому что каждый снимок — это отдельный blob-запрос:
 * публичных ссылок на файлы нет, картинка грузится с токеном и превращается
 * в object URL. Хук на элемент держит компонент, а не список.
 */
import { useState } from 'react';
import { useAttachmentPreview, useTicketAttachments } from '@shared/useAttachments';
import type { TicketAttachment } from '@shared/types';
import styles from './TicketPhotos.module.css';

function Photo({
  ticketId,
  attachment,
  isStaff,
}: {
  ticketId: string;
  attachment: TicketAttachment;
  isStaff: boolean;
}) {
  const url = useAttachmentPreview(ticketId, attachment, isStaff);
  const [opened, setOpened] = useState(false);

  if (!url) return null;

  return (
    <>
      <button
        type="button"
        className={styles.thumb}
        onClick={() => setOpened(true)}
        aria-label={`Открыть фото ${attachment.originalName}`}
      >
        <img src={url} alt={attachment.originalName} loading="lazy" />
      </button>

      {opened && (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <button
            type="button"
            className={styles.close}
            onClick={() => setOpened(false)}
            aria-label="Закрыть"
          >
            ×
          </button>
          <img className={styles.full} src={url} alt={attachment.originalName} />
        </div>
      )}
    </>
  );
}

export function TicketPhotos({
  ticketId,
  isStaff = false,
  kinds,
  commentId,
}: {
  ticketId: string;
  isStaff?: boolean;
  /** Какие виды файлов показывать: фото проблемы, фотоотчёт, файлы комментариев */
  kinds?: TicketAttachment['kind'][];
  /** Показать файлы конкретного комментария */
  commentId?: string;
}) {
  const { items, loading } = useTicketAttachments(ticketId, isStaff);

  // Фильтруем на клиенте: список один, а показываем его в трёх местах
  const visible = items.filter((item) => {
    if (kinds && !kinds.includes(item.kind)) return false;
    if (commentId && item.commentId !== commentId) return false;
    if (!commentId && !kinds) return true;
    return true;
  });

  if (loading || visible.length === 0) return null;

  return (
    <div className={styles.grid}>
      {visible.map((attachment) =>
        attachment.mimeType.startsWith('image/') ? (
          <Photo key={attachment.id} ticketId={ticketId} attachment={attachment} isStaff={isStaff} />
        ) : (
          <a
            key={attachment.id}
            className={styles.file}
            href={attachment.url}
            onClick={(event) => event.preventDefault()}
          >
            {attachment.originalName}
          </a>
        ),
      )}
    </div>
  );
}
