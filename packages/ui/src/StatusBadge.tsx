import type { CSSProperties } from 'react';
import { statusColor, statusLabel } from '@shared/format';
import type { TicketStatus } from '@shared/types';
import styles from './StatusBadge.module.css';

interface StatusBadgeProps {
  code: TicketStatus | string;
  /** Показать точку-маркер слева от текста. */
  withDot?: boolean;
}

/**
 * Бейдж статуса заявки.
 *
 * Цвет передаётся через CSS-переменную --badge-color, чтобы не заводить
 * по классу на каждый из 8 статусов.
 */
export function StatusBadge({ code, withDot = true }: StatusBadgeProps) {
  const style = { '--badge-color': statusColor(code) } as CSSProperties;

  return (
    <span className={styles.badge} style={style}>
      {withDot && <span className={styles.dot} aria-hidden="true" />}
      {statusLabel(code)}
    </span>
  );
}
