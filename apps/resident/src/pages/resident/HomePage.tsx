import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@ui/Button';
import { EmptyState } from '@ui/EmptyState';
import { CenteredSpinner } from '@ui/Spinner';
import { TicketCard } from '@ui/TicketCard';
import { useAuth } from '@shared/authContext';
import { greetingName, plural } from '@shared/format';
import { useApartment } from '@shared/apartmentContext';
import { defaultRouteFor } from '@shared/roles';
import { useTicketList } from '@shared/useTickets';
import { openAccessPoint, useAccessPoints } from '@shared/useAccess';
import { useAnnouncements } from '@shared/useUtilities';
import { formatDateTime } from '@shared/format';
import styles from './HomePage.module.css';
import pageStyles from '../pages.module.css';

/**
 * Главный экран жителя — витрина сервисов.
 *
 * Продукт задуман как «цифровая среда для современной жизни»: не только
 * заявки, но и доступ на территорию, шлагбаум, камеры, счётчики, оплата,
 * лифты, подсветка, экстренные вызовы. Сейчас работает один сервис —
 * заявки; остальные показаны заглушками, чтобы было видно направление.
 *
 * Заглушки намеренно не кликабельны и помечены «скоро»: кнопка, которая
 * молча ничего не делает, раздражает сильнее, чем честная подпись.
 *
 * Правило MVP (PROGRESS.md п. 5.2): житель не может создать заявку до
 * подтверждения привязки УК. Кнопка не прячется, а объясняется.
 */
export function HomePage() {
  const { user, roles, bindings } = useAuth();
  const { apartments, active, can, canAny } = useApartment();
  const navigate = useNavigate();
  const { items, loading, error } = useTicketList('/resident/tickets?limit=5');
  // Точки доступа нужны для быстрых кнопок «открыть дверь / шлагбаум»
  const { items: accessPoints } = useAccessPoints();
  const news = useAnnouncements();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [accessToast, setAccessToast] = useState<string | null>(null);

  const binding = active;
  const pendingBinding = bindings.find((b) => b.status === 'pending') ?? null;
  // Создавать заявки можно, если есть право (владелец или член с tickets.create)
  const canCreate = can('tickets.create');


  const addressLine = binding
    ? `${binding.addressText}, кв. ${binding.apartmentNumber}`
    : pendingBinding
      ? `${pendingBinding.addressText}, кв. ${pendingBinding.apartmentNumber} — ожидает подтверждения`
      : 'Адрес пока не привязан';

  /**
   * Быстрые кнопки для текущей квартиры: подъезд и шлагбаум.
   *
   * Идея владельца — вынести эти две кнопки на видное место, чтобы не искать
   * разделы. На домашнем экране телефона это будет виджет (нужно нативное
   * приложение, отмечено в ROADMAP), а здесь — первое, что видно на главной.
   */
  const quickPoints = useMemo(() => {
    if (!active) return [];
    const own = accessPoints.filter((point) => point.apartmentId === active.apartmentId);
    const door = own.find((point) => point.kind === 'entrance_door' || point.kind === 'wicket');
    const barrier = own.find(
      (point) => point.kind === 'barrier' || point.kind === 'gate' || point.kind === 'parking',
    );
    return [door, barrier].filter((point): point is (typeof own)[number] => Boolean(point));
  }, [accessPoints, active]);

  const handleQuickOpen = async (pointId: string) => {
    setOpeningId(pointId);
    setAccessToast(null);
    try {
      const result = await openAccessPoint(pointId, 'widget');
      setAccessToast(result.message);
    } finally {
      setOpeningId(null);
    }
  };

  /**
   * Плитки строятся по правам, а не «показать всё».
   *
   * Ребёнку положены только двери и экстренные службы, рабочему — только
   * двери. Если рисовать все плитки и потом закрывать их правами, человек
   * видит то, чего у него нет, — и это раздражает сильнее, чем отсутствие
   * плитки.
   */
  const services = [
    can('tickets.create') && {
      id: 'tickets',
      title: 'Заявки и жалобы',
      hint: 'Сантехника, электрика, двор',
      icon: 'ticket' as const,
      // Ведём в список: оттуда видно и старые заявки, и кнопку «Новая»
      active: true,
      onClick: () => navigate('/my-requests'),
    },
    can('access.open') && {
      id: 'access',
      title: 'Двери и шлагбаум',
      hint: 'Открыть подъезд, калитку, въезд',
      icon: 'gate' as const,
      active: true,
      onClick: () => navigate('/access'),
    },
    can('video.view') && {
      id: 'cctv',
      title: 'Видеонаблюдение',
      hint: 'Камеры двора и подъезда',
      icon: 'camera' as const,
      active: true,
      onClick: () => navigate('/cameras'),
    },
    can('meters.submit') && {
      id: 'meters',
      title: 'Показания счётчиков',
      hint: 'Вода и электричество',
      icon: 'meter' as const,
      active: true,
      onClick: () => navigate('/meters'),
    },
    {
      id: 'documents',
      title: 'Документы',
      hint: 'Дом и управляющая компания',
      icon: 'document' as const,
      active: true,
      onClick: () => navigate('/documents'),
    },
    {
      id: 'news',
      title: 'Объявления',
      hint: 'Сообщения УК и важные события',
      icon: 'bell' as const,
      active: true,
      onClick: () => navigate('/news'),
    },
    // Оплата и начисления появятся после подключения биллинга.
    // Лифты и экстренные сообщения не про права, а про безопасность:
    // их видят все, у кого есть доступ к квартире
    !!active && {
      id: 'lifts',
      title: 'Лифты',
      hint: 'Вызов и неисправности',
      icon: 'lift' as const,
      active: true,
      onClick: () => navigate('/lifts'),
    },
    !!active && {
      id: 'emergency',
      title: 'Экстренно',
      hint: 'Сообщения УК и вызов помощи',
      icon: 'sos' as const,
      active: true,
      onClick: () => navigate('/emergency'),
    },
    can('members.manage') && {
      id: 'members',
      title: 'Семья и доступ',
      hint: 'Пригласить и выдать права',
      icon: 'door' as const,
      active: true,
      onClick: () => navigate('/members'),
    },
  ].filter((item): item is NonNullable<typeof item> => Boolean(item)) as ServiceItem[];

  // Не житель — на этой странице делать нечего, уводим по его роли
  if (!roles.includes('resident')) {
    return <Navigate to={defaultRouteFor(roles)} replace />;
  }

  return (
    <>
      <header className={styles.hero}>
        <h1 className={styles.greeting}>Здравствуйте, {greetingName(user?.fullName)}</h1>
        <p className={styles.address}>{addressLine}</p>
        {/* Явно показываем, что квартира не своя: иначе непонятно, почему
            в ней нет начислений, заявок и показаний */}
        {/* Добавить вторую квартиру можно всегда, если человек где-то
            собственник — даже когда сейчас открыта чужая квартира */}
        {(canAny('members.manage') || apartments.length === 0) && (
          <button type="button" className={styles.addApartment} onClick={() => navigate('/binding')}>
            + Добавить квартиру
          </button>
        )}

        {active?.relation === 'granted' && (
          <p className={styles.sharedNote}>
            Доступ предоставил(а){active.grantedByName ? ` ${active.grantedByName}` : ''} · эта
            квартира не ваша
          </p>
        )}
      </header>

      {quickPoints.length > 0 && (
        <div className={styles.quick}>
          {quickPoints.map((point) => (
            <button
              key={point.id}
              type="button"
              className={styles.quickButton}
              disabled={openingId !== null || !point.isActive}
              onClick={() => void handleQuickOpen(point.id)}
            >
              <span className={styles.quickName}>{point.name}</span>
              <span className={styles.quickAction}>
                {openingId === point.id ? 'Открываем…' : 'Открыть'}
              </span>
            </button>
          ))}
        </div>
      )}

      {accessToast && (
        <p className={styles.quickToast} role="status">
          {accessToast}
        </p>
      )}

      {/* Предупреждение про привязку нужно только тем, у кого квартиры нет:
          у члена семьи квартира есть, просто заявки ему не положены */}
      {!active && (
        <div className={`${pageStyles.notice} ${pageStyles.noticeWarning}`}>
          <span className={pageStyles.noticeTitle}>
            {pendingBinding ? 'Ожидает подтверждения УК' : 'Квартира не указана'}
          </span>
          {pendingBinding
            ? 'Заявку на привязку к квартире отправили. Как только управляющая компания подтвердит её, здесь появится кнопка «Создать заявку».'
            : 'Чтобы создавать заявки, нужно указать квартиру и дождаться подтверждения от управляющей компании.'}
          <br />
          Срочный вопрос — позвоните диспетчеру УК.
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button variant="secondary" compact onClick={() => navigate('/binding')}>
              {pendingBinding ? 'Статус привязки' : 'Указать квартиру'}
            </Button>
          </div>
        </div>
      )}

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Сервисы</h2>
      </div>

      <div className={styles.services}>
        {services.map((service) => (
          <button
            key={service.id}
            type="button"
            className={[
              styles.service,
              service.active ? styles.serviceActive : styles.serviceDisabled,
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={service.onClick}
            disabled={!service.active}
            aria-disabled={!service.active}
          >
            {!service.active && <span className={styles.soon}>скоро</span>}
            <span className={styles.serviceIcon}>
              <ServiceIcon name={service.icon} />
            </span>
            <span className={styles.serviceTitle}>{service.title}</span>
            <span className={styles.serviceHint}>{service.hint}</span>
          </button>
        ))}
      </div>

      {!news.loading && news.items.length > 0 && (
        <>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Объявления</h2>
            <Button variant="ghost" compact onClick={() => navigate('/news')}>
              Все
            </Button>
          </div>
          <div className={styles.newsList}>
            {news.items.slice(0, 2).map((item) => (
              <button
                key={item.id}
                type="button"
                className={[styles.newsCard, item.isEmergency ? styles.newsEmergency : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => navigate('/news')}
              >
                <span className={styles.newsTitle}>{item.title}</span>
                <span className={styles.newsBody}>{item.body}</span>
                <span className={styles.newsDate}>
                  {formatDateTime(item.publishedAt)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Ваши заявки</h2>
        {items.length > 0 && (
          <Button variant="ghost" compact onClick={() => navigate('/my-requests')}>
            Все
          </Button>
        )}
      </div>

      {loading ? (
        <CenteredSpinner label="Загружаем заявки" />
      ) : error ? (
        <p className={pageStyles.loadError} role="alert">
          {error}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          title="Заявок пока нет"
          description={
            canCreate
              ? 'Когда появится проблема — создайте заявку, и управляющая компания её увидит.'
              : 'Здесь появятся ваши заявки. Сначала управляющая компания должна подтвердить привязку к квартире.'
          }
          action={
            canCreate ? (
              <Button variant="secondary" onClick={() => navigate('/my-requests/new')}>
                Создать первую заявку
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={pageStyles.list}>
          {items.slice(0, 3).map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              onOpen={() => navigate(`/my-requests/${ticket.id}`)}
            />
          ))}
          {items.length > 3 && (
            <Button variant="ghost" onClick={() => navigate('/my-requests')}>
              Ещё {items.length - 3} {plural(items.length - 3, 'заявка', 'заявки', 'заявок')}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

interface ServiceItem {
  id: string;
  title: string;
  hint: string;
  icon: IconName;
  active?: boolean;
  onClick?: () => void;
}

type IconName =
  | 'ticket'
  | 'door'
  | 'gate'
  | 'camera'
  | 'meter'
  | 'card'
  | 'document'
  | 'light'
  | 'lift'
  | 'bell'
  | 'sos';

/**
 * Иконки сервисов.
 *
 * Рисуются инлайном, а не берутся из набора: нужны десять простых символов,
 * а тянуть ради них библиотеку иконок в бандл незачем. Стиль общий —
 * обводка 1.6, без заливок, чтобы одинаково смотрелось на любом фоне.
 */
function ServiceIcon({ name }: { name: IconName }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'ticket':
      return (
        <svg {...common}>
          <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1a2 2 0 0 0 0 6v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-6V8Z" />
          <path d="M12 7v10" strokeDasharray="2 3" />
        </svg>
      );
    case 'door':
      return (
        <svg {...common}>
          <path d="M6 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
          <path d="M4 21h16" />
          <circle cx="13.5" cy="12" r="1" />
        </svg>
      );
    case 'gate':
      return (
        <svg {...common}>
          <path d="M3 17V9l4-3 4 3v8" />
          <path d="M11 9h10v8H11" />
          <path d="M3 17h18" />
        </svg>
      );
    case 'camera':
      return (
        <svg {...common}>
          <path d="M3 8h11l3 3v5H3z" />
          <circle cx="8" cy="12" r="2" />
          <path d="M17 11h4v6h-4" />
        </svg>
      );
    case 'meter':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 12l3-3" />
          <path d="M8 16h8" />
        </svg>
      );
    case 'card':
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10h18" />
        </svg>
      );
    case 'document':
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h4" />
        </svg>
      );
    case 'light':
      return (
        <svg {...common}>
          <path d="M9 18h6" />
          <path d="M10 21h4" />
          <path d="M12 3a6 6 0 0 0-4 10.5V15h8v-1.5A6 6 0 0 0 12 3Z" />
        </svg>
      );
    case 'lift':
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="1.5" />
          <path d="M12 3v18" />
          <path d="M8.5 9l1.5-2 1.5 2" />
          <path d="M12.5 15l1.5 2 1.5-2" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...common}>
          <path d="M18 15V10a6 6 0 1 0-12 0v5l-2 2h16l-2-2Z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
      );
    case 'sos':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5" />
          <circle cx="12" cy="16" r="0.6" fill="currentColor" />
        </svg>
      );
  }
}
