import type { ReactNode } from 'react';
import { Logo } from '../Logo';
import styles from './StaffShell.module.css';

interface StaffShellProps {
  tenantName: string;
  userName: string;
  children: ReactNode;
}

const GROUPS: { title: string; items: string[] }[] = [
  { title: 'Работа', items: ['Инбокс', 'Мои задания'] },
  { title: 'Объекты', items: ['Дома', 'Квартиры', 'Жители'] },
  { title: 'Настройки', items: ['Сотрудники', 'Профиль'] },
];

/**
 * Тёмный каркас кабинета УК.
 *
 * Отличие от жителя — не другой цвет бренда, а режим: Deep Ink-сайдбар,
 * плотная навигация, рабочая область и компактные действия. Зелёный остаётся
 * акцентом, лайм — только для активного пункта/важного действия.
 */
export function StaffShell({ tenantName, userName, children }: StaffShellProps) {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <Logo tone="dark" />
          <small>кабинет УК</small>
        </div>

        <nav className={styles.nav} aria-label="Разделы кабинета УК">
          {GROUPS.map((group) => (
            <div key={group.title} className={styles.group}>
              <span className={styles.groupTitle}>{group.title}</span>
              {group.items.map((item) => (
                <a
                  key={item}
                  href="#staff"
                  className={item === 'Инбокс' ? styles.active : undefined}
                  aria-current={item === 'Инбокс' ? 'page' : undefined}
                >
                  <span className={styles.dot} aria-hidden="true" />
                  {item}
                </a>
              ))}
            </div>
          ))}
        </nav>

        <div className={styles.user}>
          <span className={styles.avatar} aria-hidden="true">
            {userName.slice(0, 1)}
          </span>
          <span>
            <strong>{userName}</strong>
            <small>{tenantName}</small>
          </span>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div>
            <strong>Инбокс</strong>
            <span>{tenantName}</span>
          </div>
          <span className={styles.action}>Новое обращение</span>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
