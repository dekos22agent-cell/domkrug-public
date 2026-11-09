import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Alert.module.css';

type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
}

export function Alert({ variant = 'info', title, children, className, ...rest }: AlertProps) {
  return (
    <div
      className={[styles.alert, styles[variant], className ?? ''].filter(Boolean).join(' ')}
      role={variant === 'danger' ? 'alert' : 'status'}
      {...rest}
    >
      {title && <strong className={styles.title}>{title}</strong>}
      <div className={styles.body}>{children}</div>
    </div>
  );
}
