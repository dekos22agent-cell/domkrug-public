import type { ReactNode } from 'react';
import { Logo } from '../Logo';
import styles from './ResidentShell.module.css';

interface ResidentShellProps {
  userName: string;
  address: string;
  children: ReactNode;
}

const NAV = ['Главная', 'Заявки', 'Доступ', 'Квартира', 'Профиль'];

/**
 * Светлый каркас приложения жителя.
 *
 * Это layout из UI Kit, а не production-компонент: он показывает характер
 * продукта — бумага, крупные карточки, зелёный акцент, нижняя навигация.
 */
export function ResidentShell({ userName, address, children }: ResidentShellProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Logo />
        </div>
        <div className={styles.address}>{address}</div>
        <nav className={styles.nav} aria-label="Разделы жителя">
          {NAV.map((item, index) => (
            <a
              key={item}
              href="#resident"
              className={index === 0 ? styles.active : undefined}
              aria-current={index === 0 ? 'page' : undefined}
            >
              {item}
            </a>
          ))}
        </nav>
        <span className={styles.user}>{userName}</span>
      </header>

      <main className={styles.main}>{children}</main>

      <nav className={styles.bottomNav} aria-label="Разделы жителя">
        {NAV.slice(0, 4).map((item, index) => (
          <a
            key={item}
            href="#resident"
            className={index === 0 ? styles.active : undefined}
            aria-current={index === 0 ? 'page' : undefined}
          >
            {item}
          </a>
        ))}
      </nav>
    </div>
  );
}
