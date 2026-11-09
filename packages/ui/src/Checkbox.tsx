import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import styles from './Checkbox.module.css';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: string;
  indeterminate?: boolean;
  error?: string | null;
}

export function Checkbox({
  label,
  description,
  indeterminate = false,
  error,
  className,
  ...rest
}: CheckboxProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={styles.row} htmlFor={id}>
      <input
        ref={inputRef}
        id={id}
        type="checkbox"
        className={[styles.input, className ?? ''].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : description ? descriptionId : undefined}
        {...rest}
      />
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {description && (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        )}
        {error && (
          <span id={errorId} className={styles.error} role="alert">
            {error}
          </span>
        )}
      </span>
    </label>
  );
}
