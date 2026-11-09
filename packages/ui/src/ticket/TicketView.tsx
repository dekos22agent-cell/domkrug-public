/**
 * Карточка заявки без привязки к роли.
 *
 * Что здесь: шапка, данные, описание с фото, результат работ, лента
 * комментариев, ход заявки. Что снаружи: форма комментария и блок действий —
 * у жителя и УК они разные, и держать их внутри одного компонента значило бы
 * снова завести ветвление по роли.
 *
 * `attachmentsForStaff` — не про права в интерфейсе, а про адрес API: вложения
 * жителя и сотрудника живут на разных эндпоинтах (/resident/tickets и /tickets).
 */
import type { ReactNode } from 'react';
import { StatusBadge } from '../StatusBadge';
import { TicketPhotos } from '../TicketPhotos';
import {
  formatDateTime,
  formatPhone,
  formatRelative,
  formatTicketNumber,
  priorityLabel,
} from '@shared/format';
import type { TicketDetail, TicketHistoryItem } from '@shared/types';
import styles from './TicketView.module.css';

const SOURCE_LABELS: Record<string, string> = {
  resident_app: 'Через приложение',
  dispatcher_phone: 'По телефону',
  dispatcher_walkin: 'На личном приёме',
};

export interface TicketViewProps {
  ticket: TicketDetail;
  /** Вложения тянуть по адресу сотрудника УК */
  attachmentsForStaff: boolean;
  history: TicketHistoryItem[];
  historyLoading: boolean;
  historyError: string | null;
  onBack: () => void;
  onOpenParent: (ticketId: string) => void;
  /** Форма комментария: у жителя и УК разные адреса и права */
  composer: ReactNode;
  /** Блок действий роли. Если не передан — раздела «Действия» нет */
  actions?: ReactNode;
}

export function TicketView({
  ticket,
  attachmentsForStaff,
  history,
  historyLoading,
  historyError,
  onBack,
  onOpenParent,
  composer,
  actions,
}: TicketViewProps) {
  const status = ticket.status.code;

  return (
    <>
      <button type="button" className={styles.backLink} onClick={onBack}>
        ← Назад
      </button>

      <header className={styles.header}>
        <div className={styles.badges}>
          <span className={styles.number}>{formatTicketNumber(ticket.number)}</span>
          <StatusBadge code={status} />
          {ticket.priority === 'emergency' && <span className={styles.flag}>Аварийная</span>}
          {ticket.isOverdue && <span className={styles.flag}>Просрочена</span>}
        </div>
        <h1 className={styles.title}>{ticket.title ?? ticket.category.name}</h1>
      </header>

      <div className={styles.card}>
        <div className={styles.meta}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Категория</span>
            <span className={styles.metaValue}>{ticket.category.name}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Адрес</span>
            <span className={styles.metaValue}>
              {ticket.building.addressText}
              {ticket.apartment ? `, кв. ${ticket.apartment.number}` : ''}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Срочность</span>
            <span className={styles.metaValue}>{priorityLabel(ticket.priority)}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Исполнитель</span>
            <span className={styles.metaValue}>{ticket.assignedTo?.fullName ?? 'не назначен'}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Источник</span>
            <span className={styles.metaValue}>{SOURCE_LABELS[ticket.source] ?? ticket.source}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Контакт для связи</span>
            <span className={styles.metaValue}>
              {ticket.contactName ? `${ticket.contactName} · ` : ''}
              {ticket.contactPhone ? formatPhone(ticket.contactPhone) : 'скрыт'}
            </span>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Описание</h2>
          <p className={styles.description}>{ticket.description}</p>
          <TicketPhotos
            ticketId={ticket.id}
            isStaff={attachmentsForStaff}
            kinds={['request_photo']}
          />
          {ticket.locationNote && (
            <p className={styles.description} style={{ marginTop: 'var(--space-2)' }}>
              <span className={styles.metaLabel}>Где: </span>
              {ticket.locationNote}
            </p>
          )}
          {ticket.parentTicket && (
            <button
              type="button"
              className={styles.parentLink}
              onClick={() => onOpenParent(ticket.parentTicket!.id)}
            >
              Повторное обращение по заявке {formatTicketNumber(ticket.parentTicket.number)}
            </button>
          )}
        </div>

        {status === 'closed' && ticket.resolutionNote && (
          <div className={styles.resolution}>
            <span className={styles.resolutionTitle}>Что сделано</span>
            <p className={styles.description}>{ticket.resolutionNote}</p>
            <TicketPhotos
              ticketId={ticket.id}
              isStaff={attachmentsForStaff}
              kinds={['result_photo']}
            />
          </div>
        )}
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Комментарии</h2>

        {ticket.comments.length === 0 ? (
          <p className={styles.emptyComments}>Пока нет комментариев</p>
        ) : (
          <div className={styles.comments}>
            {ticket.comments.map((comment) => (
              <div
                key={comment.id}
                className={[styles.comment, comment.isInternal ? styles.commentInternal : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className={styles.commentHead}>
                  <span className={styles.commentAuthor}>{comment.author.fullName}</span>
                  <span className={styles.commentTime} title={formatDateTime(comment.createdAt)}>
                    {formatRelative(comment.createdAt)}
                  </span>
                  {comment.isInternal && <span className={styles.internalMark}>Служебный</span>}
                </div>
                <p className={styles.commentBody}>{comment.body}</p>
                <TicketPhotos
                  ticketId={ticket.id}
                  isStaff={attachmentsForStaff}
                  commentId={comment.id}
                />
              </div>
            ))}
          </div>
        )}

        {composer}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Ход заявки</h2>

        <div className={styles.timeline}>
          <div className={styles.timelineRow}>
            <span className={styles.timelineLabel}>Создана</span>
            <span className={styles.timelineValue}>
              {formatDateTime(ticket.createdAt)} · {ticket.createdBy.fullName}
            </span>
          </div>

          {historyLoading ? (
            <div className={styles.timelineRow}>
              <span className={styles.timelineLabel}>Изменения</span>
              <span className={styles.timelineValue}>загружаем…</span>
            </div>
          ) : historyError ? (
            <div className={styles.timelineRow}>
              <span className={styles.timelineLabel}>Изменения</span>
              <span className={styles.timelineValue}>{historyError}</span>
            </div>
          ) : history.length === 0 ? (
            <div className={styles.timelineRow}>
              <span className={styles.timelineLabel}>Изменения</span>
              <span className={styles.timelineValue}>статус ещё не менялся</span>
            </div>
          ) : (
            // Первая запись — само создание, оно уже показано строкой выше
            history
              .filter((item) => item.from !== null)
              .map((item, index) => (
                <div key={`${item.at}-${index}`} className={styles.timelineEvent}>
                  <div className={styles.eventHead}>
                    <span className={styles.eventStatus}>{item.to.name}</span>
                    <span className={styles.eventMeta}>
                      {formatDateTime(item.at)} · {item.by}
                    </span>
                  </div>
                  {item.comment && <p className={styles.eventComment}>{item.comment}</p>}
                </div>
              ))
          )}
        </div>

        <p className={styles.timelineNote}>
          Эти изменения видит и житель — он должен понимать, что происходит с его заявкой.
          Для внутренних заметок есть служебный комментарий.
        </p>
      </section>

      {actions && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Действия</h2>
          <div className={styles.actions}>{actions}</div>
        </section>
      )}
    </>
  );
}

/** Обёртка панели действия: заголовок, ошибка и содержимое. */
export function ActionPanel({
  title,
  error,
  children,
}: {
  title: string;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <div className={styles.actionPanel}>
      <p className={styles.actionPanelTitle}>{title}</p>
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}
