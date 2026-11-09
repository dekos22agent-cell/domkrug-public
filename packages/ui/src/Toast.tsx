import type { ReactNode } from 'react';
import styles from './Toast.module.css';

type ToastVariant = 'success' | 'info' | 'danger';

interface ToastProps {
  variant?: ToastVariant;
  title?: string;
  children: ReactNode;
  onClose?: () => void;
}

export function Toast({ variant = 'success', title, children, onClose }: ToastProps) {
  return (
    <div className={[styles.toast, styles[variant]].join(' ')} role={variant === 'danger' ? 'alert' : 'status'}>
      <div className={styles.text}>
        {title && <strong className={styles.title}>{title}</strong>}
        <span>{children}</span>
      </div>
      {onClose && (
        <button type="button" className={styles.close} onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      )}
    </div>
  );
}
