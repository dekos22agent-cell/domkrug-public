import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'accent';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Размер из UI Kit: 32 / 40 / 48 px. */
  size?: Size;
  /** Узкий вариант для интерфейса сотрудников УК (совместимость). */
  compact?: boolean;
  /** Растянуть на всю ширину контейнера. */
  block?: boolean;
  /** Показать спиннер и заблокировать кнопку. */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size,
  compact = false,
  block = false,
  loading = false,
  leadingIcon,
  trailingIcon,
  disabled,
  children,
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    size ? styles[size] : '',
    compact && !size ? styles.compact : '',
    block ? styles.block : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      // type="button" по умолчанию: иначе кнопка внутри формы отправляет её,
      // а это почти всегда не то, что нужно.
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
}
