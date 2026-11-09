/**
 * «Вы не в том приложении».
 *
 * После разделения клиентов сотрудник УК может открыть приложение жителя,
 * а житель — кабинет УК. Вместо 404 или пустого экрана объясняем, что
 * произошло, и даём кнопку туда, куда нужно.
 */
import styles from './WrongAppNotice.module.css';

export interface WrongAppNoticeProps {
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
  onLogout?: () => void;
}

export function WrongAppNotice({
  title,
  description,
  actionLabel,
  actionHref,
  onLogout,
}: WrongAppNoticeProps) {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.mark} aria-hidden="true">
          {/* Дверь с двумя створками: «это другой вход» */}
          <svg viewBox="0 0 120 120" className={styles.svg}>
            <rect x="14" y="18" width="44" height="84" rx="6" fill="#1f6f54" />
            <rect x="62" y="18" width="44" height="84" rx="6" fill="#0f3d2e" />
            <circle cx="50" cy="62" r="3.5" fill="#f3f7f4" />
            <circle cx="70" cy="62" r="3.5" fill="#7fd3b1" />
            <path d="M60 18v84" stroke="#e6f4ee" strokeWidth="2" strokeDasharray="4 4" />
          </svg>
        </div>

        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>

        <div className={styles.actions}>
          <a className={`${styles.btn} ${styles.btnPrimary}`} href={actionHref}>
            {actionLabel}
          </a>
          {onLogout && (
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onLogout}>
              Выйти
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
