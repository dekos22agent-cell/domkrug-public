import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import styles from './Radio.module.css';

interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: string;
}

export function Radio({ label, description, className, ...rest }: RadioProps) {
  const id = useId();
  const descriptionId = `${id}-description`;

  return (
    <label className={styles.row} htmlFor={id}>
      <input
        id={id}
        type="radio"
        className={[styles.input, className ?? ''].filter(Boolean).join(' ')}
        aria-describedby={description ? descriptionId : undefined}
        {...rest}
      />
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {description && (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
