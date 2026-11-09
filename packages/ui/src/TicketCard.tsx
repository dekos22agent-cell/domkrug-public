import type { TicketSummary } from '@shared/types';
import { formatRelative, formatTicketNumber } from '@shared/format';
import { StatusBadge } from './StatusBadge';
import styles from './TicketCard.module.css';

interface TicketCardProps {
  ticket: TicketSummary;
  onOpen: (id: string) => void;
}

/**
 * Карточка заявки в списке.
 *
 * Сделана кнопкой, а не ссылкой: переход на карточку — действие внутри SPA,
 * и это даёт правильную работу с клавиатуры (Enter/Space) без хаков.
 */
export function TicketCard({ ticket, onOpen }: TicketCardProps) {
  const classes = [
    styles.card,
    ticket.priority === 'emergency' ? styles.emergency : '',
    ticket.isOverdue ? styles.overdue : '',
  ]
    .filter(Boolean)
    .join(' ');

  const address = ticket.apartment
    ? `${ticket.building.addressText}, кв. ${ticket.apartment.number}`
    : ticket.building.addressText;

  return (
    <button type="button" className={classes} onClick={() => onOpen(ticket.id)}>
      <div className={styles.badges}>
        <StatusBadge code={ticket.status.code} />
        {ticket.priority === 'emergency' && <span className={styles.flag}>Аварийная</span>}
        {ticket.isOverdue && <span className={styles.flag}>Просрочена</span>}
      </div>

      <div className={styles.top}>
        <span className={styles.number}>{formatTicketNumber(ticket.number)}</span>
        <span className={styles.number}>{formatRelative(ticket.createdAt)}</span>
      </div>

      <p className={styles.title}>{ticket.title ?? ticket.category.name}</p>

      <div className={styles.meta}>
        <span className={styles.metaItem}>{ticket.category.name}</span>
        <span className={styles.metaItem}>{address}</span>
        {ticket.assignedTo && (
          <span className={styles.metaItem}>Исполнитель: {ticket.assignedTo.fullName}</span>
        )}
      </div>
    </button>
  );
}
