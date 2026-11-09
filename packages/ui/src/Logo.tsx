import styles from './Logo.module.css';

interface LogoProps {
  /** Марка без названия — для favicon-подобных мест и тесных шапок. */
  variant?: 'full' | 'mark';
  /** Тёмный фон: светлая версия знака и белая надпись. */
  tone?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Логотип Liviti.
 *
 * Знак — 3×3 квадрата; на светлом фоне зелёно-золотая версия, на тёмном —
 * лаймово-песочная. Название набрано Manrope 800, как в Brand Book; после
 * утверждения финального логотипа текст можно перевести в кривые.
 */
export function Logo({
  variant = 'full',
  tone = 'light',
  size = 'md',
  className,
}: LogoProps) {
  return (
    <span
      className={[styles.logo, styles[size], styles[tone], className ?? '']
        .filter(Boolean)
        .join(' ')}
      role="img"
      aria-label="liviti"
    >
      <svg
        className={styles.mark}
        viewBox="0 0 64 64"
        aria-hidden="true"
        focusable="false"
      >
        {tone === 'dark' ? (
          <>
            <rect x="8" y="8" width="14" height="14" rx="3" fill="#C5E58A" />
            <rect x="25" y="8" width="14" height="14" rx="3" fill="#F3E3A4" fillOpacity=".9" />
            <rect x="42" y="8" width="14" height="14" rx="3" fill="#2A4650" />
            <rect x="8" y="25" width="14" height="14" rx="3" fill="#2A4650" />
            <rect x="25" y="25" width="14" height="14" rx="3" fill="#C5E58A" fillOpacity=".55" />
            <rect x="42" y="25" width="14" height="14" rx="3" fill="#E9B96E" />
            <rect x="8" y="42" width="14" height="14" rx="3" fill="#F3E3A4" fillOpacity=".6" />
            <rect x="25" y="42" width="14" height="14" rx="3" fill="#2A4650" />
            <rect x="42" y="42" width="14" height="14" rx="3" fill="#C5E58A" fillOpacity=".8" />
          </>
        ) : (
          <>
            <rect x="8" y="8" width="14" height="14" rx="3" fill="#285B50" />
            <rect x="25" y="8" width="14" height="14" rx="3" fill="#D9A04D" fillOpacity=".9" />
            <rect x="42" y="8" width="14" height="14" rx="3" fill="#DDE6DF" />
            <rect x="8" y="25" width="14" height="14" rx="3" fill="#DDE6DF" />
            <rect x="25" y="25" width="14" height="14" rx="3" fill="#285B50" fillOpacity=".55" />
            <rect x="42" y="25" width="14" height="14" rx="3" fill="#B9DC7A" />
            <rect x="8" y="42" width="14" height="14" rx="3" fill="#D9A04D" fillOpacity=".6" />
            <rect x="25" y="42" width="14" height="14" rx="3" fill="#DDE6DF" />
            <rect x="42" y="42" width="14" height="14" rx="3" fill="#285B50" fillOpacity=".8" />
          </>
        )}
      </svg>
      {variant === 'full' && (
        <span className={styles.word} aria-hidden="true">
          liviti
        </span>
      )}
    </span>
  );
}
