/**
 * Страница 404.
 *
 * Иллюстрация в духе продукта: подъездная дверь с панелью, на которой вместо
 * номера квартиры — 404. Так ошибка выглядит частью сервиса, а не системным
 * экраном. Рисунок нарисован кодом (SVG), поэтому не тянет картинки и
 * масштабируется без потерь.
 *
 * Компонент общий: его используют приложение жителя, кабинет УК и лендинг.
 */
import styles from './NotFound.module.css';

export interface NotFoundProps {
  title?: string;
  description?: string;
  /** Куда вести по кнопке «На главную». На лендинге это simply '/' */
  onHome?: () => void;
  homeLabel?: string;
  /** Кнопка «Назад» показывается только если передан обработчик */
  onBack?: () => void;
}

export function NotFound({
  title = 'Такой страницы нет',
  description = 'Возможно, ссылка устарела или раздел переехал. Дверь на месте — просто номер другой.',
  onHome,
  homeLabel = 'На главную',
  onBack,
}: NotFoundProps) {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.art} aria-hidden="true">
          <svg viewBox="0 0 320 260" role="presentation" className={styles.svg}>
            {/* Стена и дверной проём */}
            <rect x="40" y="30" width="180" height="200" rx="10" className={styles.wall} />
            <rect x="58" y="46" width="144" height="184" rx="8" className={styles.frame} />
            <rect x="70" y="58" width="120" height="172" rx="6" className={styles.door} />

            {/* Ручка */}
            <circle cx="176" cy="148" r="6" className={styles.handle} />

            {/* Панель вызова: вместо номера — 404 */}
            <rect x="216" y="96" width="78" height="104" rx="10" className={styles.panel} />
            <rect x="226" y="106" width="58" height="34" rx="6" className={styles.screen} />
            <text x="255" y="130" textAnchor="middle" className={styles.code}>
              404
            </text>

            {/* Кнопки набора */}
            <g className={styles.keys}>
              <rect x="226" y="148" width="16" height="12" rx="3" />
              <rect x="247" y="148" width="16" height="12" rx="3" />
              <rect x="268" y="148" width="16" height="12" rx="3" />
              <rect x="226" y="165" width="16" height="12" rx="3" />
              <rect x="247" y="165" width="16" height="12" rx="3" />
              <rect x="268" y="165" width="16" height="12" rx="3" />
              <rect x="226" y="182" width="16" height="12" rx="3" />
              <rect x="247" y="182" width="16" height="12" rx="3" />
            </g>

            {/* Гость с коробкой: он-то пришёл по адресу */}
            <g className={styles.visitor}>
              <circle cx="118" cy="196" r="12" />
              <rect x="104" y="210" width="28" height="30" rx="6" />
              <rect x="134" y="214" width="24" height="22" rx="4" />
              <path d="M134 214v22M146 214v22" className={styles.tape} />
            </g>

            {/* Растение у двери */}
            <g className={styles.plant}>
              <rect x="36" y="200" width="26" height="26" rx="4" />
              <path d="M49 200c0-14 8-22 18-26-2 14-8 22-18 26Z" />
              <path d="M49 200c0-12-7-18-16-21 1 12 7 18 16 21Z" />
            </g>
          </svg>
        </div>

        <p className={styles.code404}>404</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>

        <div className={styles.actions}>
          {onHome && (
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onHome}>
              {homeLabel}
            </button>
          )}
          {onBack && (
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onBack}>
              Назад
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
