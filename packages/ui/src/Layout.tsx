import { NavLink, Outlet } from 'react-router-dom';
import { IntercomCallOverlay } from './IntercomCallOverlay';
import { NotificationBell } from './NotificationBell';
import { useApartment } from '@shared/apartmentContext';
import { useAuth } from '@shared/authContext';
import { shortAddress } from '@shared/format';
import { Button } from './Button';
import { Logo } from './Logo';
import styles from './Layout.module.css';

/** Главный сайт: логотип ведёт на него, а не на текущее приложение */
const LANDING_URL = (import.meta.env.VITE_LANDING_URL as string | undefined) ?? 'https://liviti.ru/';

interface NavItem {
  to: string;
  label: string;
  /** Короткая подпись для нижней навигации на телефоне. */
  short: string;
}

/**
 * Навигация по роли.
 *
 * Пункты построены на правах, а не на названии роли: если у человека несколько
 * ролей (админ УК, который сам живёт в доме), он видит все доступные разделы.
 */
function navItemsFor(roles: string[], ownsAnyApartment: boolean): NavItem[] {
  const items: NavItem[] = [];

  if (roles.includes('resident')) {
    // Только четыре раздела: больше не влезает ни в верхнее меню на десктопе,
    // ни в нижнее на телефоне. Остальное — плитками на главной, где всё видно
    // сразу и не нужно прокручивать меню.
    items.push({ to: '/', label: 'Главная', short: 'Главная' });
    items.push({ to: '/my-requests', label: 'Заявки', short: 'Заявки' });
    items.push({ to: '/access', label: 'Доступ', short: 'Доступ' });
    // Привязку квартиры ищет только владелец: члену семьи и рабочему искать
    // нечего, квартира им уже выдана
    if (ownsAnyApartment) {
      items.push({ to: '/binding', label: 'Квартира', short: 'Квартира' });
    }
  }


  items.push({ to: '/profile', label: 'Профиль', short: 'Профиль' });

  return items;
}

export function Layout() {
  const { user, roles, tenant, logout } = useAuth();
  // У жителя может быть несколько квартир в разных УК — показываем переключатель
  const { apartments, active, setActive, canAny } = useApartment();
  // Пункт «Квартира» нужен и тому, у кого квартир ещё нет: именно там их
  // добавляют
  const canAnyOwned = canAny('members.manage') || apartments.length === 0;
  const items = navItemsFor(roles, canAnyOwned);

  // Это приложение жителя: широкая колонка и крупные элементы (DESIGN.md п. 3).
  // Плотный интерфейс УК живёт в отдельном приложении.
  const isStaffView = false;

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
          <a className={styles.brand} href={LANDING_URL} title="На главную сайта">
            <Logo />
            {tenant && <span className={styles.tenantName}>· {tenant.name}</span>}
          </a>

          <nav className={styles.nav} aria-label="Основная навигация">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          {apartments.length > 1 && active && (
            <label className={styles.apartmentSwitch}>
              <span className={styles.apartmentSwitchLabel}>Квартира</span>
              <select
                className={styles.apartmentSelect}
                value={active.id}
                onChange={(event) => setActive(event.target.value)}
                aria-label="Выбор квартиры"
              >
                {apartments.map((apartment) => (
                  <option
                    key={apartment.id}
                    value={apartment.id}
                    title={`${apartment.addressText}, кв. ${apartment.apartmentNumber}`}
                  >
                    {/* Номер квартиры — первым: все адреса начинаются с «г. Барнаул»,
                        и в узком селекте именно номер отличает одну квартиру от другой */}
                    кв. {apartment.apartmentNumber} · {shortAddress(apartment.addressText)}
                    {apartment.relation === 'owner' ? ' · моя' : ' · по доступу'}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className={styles.user}>
            {/* Колокольчик — перед именем: справа сверху его ищут */}
            <NotificationBell />
            {/* Имя — крупнее и ведёт в профиль, как в кабинете УК */}
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

      <main className={[styles.main, isStaffView ? styles.mainStaff : styles.mainResident].join(' ')}>
        <Outlet />
      </main>

      {/* Звонок в домофон появляется поверх любого экрана жителя */}
      {roles.includes('resident') && <IntercomCallOverlay />}

      {/* На телефоне верхняя навигация скрыта — вместо неё нижняя */}
      <nav className={styles.bottomNav} aria-label="Навигация по разделам">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={bottomLinkClass}>
            {item.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
