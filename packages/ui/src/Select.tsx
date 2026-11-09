import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import styles from './Select.module.css';

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}

export function Select({ label, error, hint, className, children, ...rest }: SelectProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.control}>
        <select
          id={id}
          className={[styles.select, error ? styles.invalid : '', className ?? '']
            .filter(Boolean)
            .join(' ')}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        >
          {children}
        </select>
        <span className={styles.chevron} aria-hidden="true">
          ⌄
        </span>
      </div>
      {error ? (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
