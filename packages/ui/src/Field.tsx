import { useId, type InputHTMLAttributes } from 'react';
import styles from './Field.module.css';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Ошибка поля. Если задана — рамка красная и текст под полем. */
  error?: string | null;
  /** Подсказка под полем. Скрывается, если есть ошибка. */
  hint?: string;
}

export function Field({ label, error, hint, className, ...rest }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={[styles.input, error ? styles.invalid : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
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
