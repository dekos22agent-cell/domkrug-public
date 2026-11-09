import { useId, useRef, type ReactNode } from 'react';
import { useDialogFocus } from './useDialogFocus';
import styles from './Drawer.module.css';

interface DrawerProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
}

/**
 * Боковая панель для деталей без потери контекста списка.
 *
 * Поведение как у Modal: focus trap, Escape, возврат фокуса, блокировка фона.
 */
export function Drawer({ title, children, onClose }: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, onClose);

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
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
