import { useId, type TextareaHTMLAttributes } from 'react';
import styles from './TextArea.module.css';

interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  /** Ошибка поля. Если задана — рамка красная и текст под полем. */
  error?: string | null;
  /** Подсказка под полем. Скрывается, если есть ошибка. */
  hint?: string;
  /** Показать счётчик введённых символов (полезно для описания проблемы). */
  showCounter?: boolean;
}

export function TextArea({
  label,
  error,
  hint,
  showCounter = false,
  className,
  value,
  ...rest
}: TextAreaProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint || showCounter ? hintId : undefined;

  const length = typeof value === 'string' ? value.length : 0;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className={[styles.textarea, error ? styles.invalid : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        value={value}
        {...rest}
      />
      {error ? (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      ) : (
        (hint || showCounter) && (
          <span id={hintId} className={styles.hint}>
            <span>{hint}</span>
            {showCounter && <span>{length}</span>}
          </span>
        )
      )}
    </div>
  );
}
