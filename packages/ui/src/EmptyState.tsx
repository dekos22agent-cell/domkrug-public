import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  /** Заголовок: что именно пусто. «Заявок пока нет». */
  title: string;
  /** Пояснение или подсказка, что делать дальше. */
  description?: string;
  /** Простой символ вместо иконки — на MVP не тянем библиотеку иконок. */
  icon?: string;
  /** Кнопка действия. */
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className={styles.wrapper}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
