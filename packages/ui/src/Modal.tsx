import { useId, useRef, type ReactNode } from 'react';
import { useDialogFocus } from './useDialogFocus';
import styles from './Modal.module.css';

type ModalSize = 'sm' | 'md' | 'lg';

/**
 * Модальное окно.
 *
 * Доступность: role=dialog + aria-modal, фокус уходит в окно, Tab не выходит
 * за его пределы, Esc закрывает, после закрытия фокус возвращается на элемент,
 * который открыл окно. Фон не прокручивается.
 */
export function Modal({
  title,
  children,
  onClose,
  size = 'md',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  size?: ModalSize;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={[styles.dialog, styles[size]].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
