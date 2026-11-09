/**
 * Каркас кабинета УК.
 *
 * Отличия от каркаса жителя: нет переключателя квартир, нет звонка в домофон,
 * нет заявок жителя и плиток главной. Только рабочее: инбокс, мои задания,
 * квартиры, привязки и профиль. Профиль — отдельный раздел, потому что там
 * права, организация и смена пароля; в шапке для него слишком мало места.
 */
import { NavLink, Outlet } from 'react-router-dom';
import { NotificationBell } from '@ui/NotificationBell';
import { Button } from '@ui/Button';
import { Logo } from '@ui/Logo';
import { useAuth } from '@shared/authContext';
import styles from './StaffLayout.module.css';

interface NavItem {
  to: string;
  label: string;
  /** Короткая подпись для нижней навигации на телефоне исполнителя */
  short: string;
}

/** Пункты меню строятся по правам: у исполнителя не будет «Привязок». */
function staffNav(can: (code: string) => boolean): NavItem[] {
  const items: NavItem[] = [];

  if (can('ticket.view.all')) {
    items.push({ to: '/inbox', label: 'Инбокс', short: 'Инбокс' });
  }
  if (can('ticket.view.assigned')) {
    items.push({ to: '/my', label: 'Мои задания', short: 'Задания' });
  }
  if (can('building.view')) {
    items.push({ to: '/objects', label: 'Объекты', short: 'Объекты' });
  }
  if (can('news.view')) {
    items.push({ to: '/news', label: 'Объявления', short: 'Новости' });
    items.push({ to: '/documents', label: 'Документы', short: 'Документы' });
  }
  if (can('apartment.manage')) {
    items.push({ to: '/apartments', label: 'Квартиры', short: 'Квартиры' });
  }
  if (can('resident_binding.view')) {
    items.push({ to: '/bindings', label: 'Привязки', short: 'Привязки' });
  }

  // Профиль не зависит от прав: это собственные данные сотрудника
  items.push({ to: '/profile', label: 'Профиль', short: 'Профиль' });

  return items;
}

export function StaffLayout() {
  const { user, tenant, hasPermission, logout } = useAuth();
  const items = staffNav(hasPermission);
  const cabinetHome = hasPermission('ticket.view.all')
    ? '/inbox'
    : hasPermission('ticket.view.assigned')
      ? '/my'
      : '/objects';

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    [styles.navLink, isActive ? styles.navLinkActive : ''].filter(Boolean).join(' ');

  const bottomLinkClass = ({ isActive }: { isActive: boolean }) =>
    [styles.bottomNavLink, isActive ? styles.bottomNavLinkActive : '']
      .filter(Boolean)
      .join(' ');

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            <NavLink
              to={cabinetHome}
              className={styles.brandLogo}
              title="На главную кабинета"
            >
              <Logo tone="dark" />
            </NavLink>
            <span className={styles.tenantName}>кабинет УК</span>
            {tenant && (
              <span className={[styles.tenantName, styles.tenantCompany].join(' ')}>
                · {tenant.name}
              </span>
            )}
          </div>

          <nav className={styles.nav} aria-label="Рабочие разделы">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className={styles.user}>
            <span className={styles.bell}>
              <NotificationBell placement="top-start" />
            </span>
            {/* Имя ведёт в профиль: это самый ожидаемый путь к своим данным */}
            <NavLink to="/profile" className={styles.userName} title="Открыть профиль">
              {user?.fullName}
            </NavLink>
            <Button
              variant="ghost"
              compact
              className={styles.logout}
              onClick={() => void logout()}
              aria-label="Выйти"
              title="Выйти"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </Button>
          </div>
        </div>
      </header>

      <main className={[styles.main, styles.mainStaff].join(' ')}>
        <Outlet />
      </main>

      {/* На телефоне исполнителя верхнее меню скрыто — вместо него нижнее */}
      <nav className={styles.bottomNav} aria-label="Разделы">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} className={bottomLinkClass}>
            {item.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
