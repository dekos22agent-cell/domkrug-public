import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Badge.module.css';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type BadgeSize = 'sm' | 'md';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: ReactNode;
}

/**
 * Универсальный статусный бейдж.
 *
 * Для статусов заявок остаётся StatusBadge (он знает коды); этот компонент —
 * для устройств, доступов и произвольных состояний. Цвет всегда дублируется
 * текстом, поэтому вариант — семантика, а не единственный носитель смысла.
 */
export function Badge({
  variant = 'neutral',
  size = 'md',
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={[styles.badge, styles[variant], styles[size], className ?? '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </span>
  );
}
