import { cloneElement, useId, useState, type ReactElement } from 'react';
import styles from './Tooltip.module.css';

interface TooltipProps {
  label: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
}

/**
 * Подсказка для supplementary-текста.
 *
 * Показывается по hover и по фокусу, связана с триггером через
 * aria-describedby. Для критически важной информации tooltip не использовать:
 * на тач-устройствах она может быть недоступна.
 */
export function Tooltip({ label, children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className={styles.wrapper}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      {open && (
        <span id={id} role="tooltip" className={styles.tooltip}>
          {label}
        </span>
      )}
    </span>
  );
}
