import { useId, type ReactNode } from 'react';
import styles from './Switch.module.css';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: string;
  disabled?: boolean;
  name?: string;
}

/**
 * Переключатель настройки.
 *
 * role="switch" и aria-checked дают корректное поведение скринридеру;
 * область нажатия — вся строка, минимум 44 px.
 */
export function Switch({ checked, onChange, label, description, disabled = false, name }: SwitchProps) {
  const id = useId();
  const descriptionId = `${id}-description`;

  return (
    <div className={styles.row}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        className={[styles.switch, checked ? styles.on : ''].filter(Boolean).join(' ')}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.track} aria-hidden="true">
          <span className={styles.thumb} />
        </span>
      </button>
      <label className={styles.text} htmlFor={id}>
        <span id={`${id}-label`} className={styles.label}>
          {label}
        </span>
        {description && (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        )}
        {name && <input type="hidden" name={name} value={checked ? 'on' : 'off'} />}
      </label>
    </div>
  );
}
