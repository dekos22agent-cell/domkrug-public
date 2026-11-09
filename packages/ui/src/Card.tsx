import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Тень только для отдельного слоя, не для каждой карточки подряд. */
  elevated?: boolean;
  children: ReactNode;
}

export function Card({ elevated = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={[styles.card, elevated ? styles.elevated : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}
