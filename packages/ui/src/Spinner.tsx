import styles from './Spinner.module.css';

interface SpinnerProps {
  /** Размер в пикселях. */
  size?: number;
  /** Подпись для скринридера. */
  label?: string;
}

export function Spinner({ size = 24, label = 'Загрузка' }: SpinnerProps) {
  return (
    <span
      className={styles.spinner}
      style={{ width: size, height: size }}
      role="status"
      aria-label={label}
    />
  );
}

/** Крупный спиннер по центру — для экранов, которые ещё грузятся целиком. */
export function CenteredSpinner({ label = 'Загрузка' }: { label?: string }) {
  return (
    <div className={styles.centered}>
      <Spinner size={32} label={label} />
    </div>
  );
}
