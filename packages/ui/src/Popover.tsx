import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import styles from './Popover.module.css';

interface PopoverProps {
  label: string;
  trigger: ReactElement<{
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    'aria-expanded'?: boolean;
    'aria-haspopup'?: 'dialog';
    'aria-controls'?: string;
  }>;
  children: ReactNode;
  align?: 'start' | 'end';
}

/**
 * Небольшой контекстный слой.
 *
 * Не для длинных форм и не для критических действий: закрывается по клику вне
 * и Escape, фокус уходит в панель. Полноценный focus trap не нужен, пока
 * внутри нет многошагового сценария.
 */
export function Popover({ label, trigger, children, align = 'start' }: PopoverProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span className={styles.root} ref={rootRef}>
      {cloneElement(trigger, {
        onClick: (event: ReactMouseEvent<HTMLElement>) => {
          trigger.props.onClick?.(event);
          setOpen((value) => !value);
        },
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        'aria-controls': id,
      })}
      {open && (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={[styles.panel, styles[align]].join(' ')}
        >
          {children}
        </div>
      )}
    </span>
  );
}
