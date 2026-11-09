/**
 * Главная страница liviti.
 *
 * Витрина, а не продукт: объясняет за две минуты, что делают приложение жителя
 * и кабинет УК, и уводит в нужный вход. Ссылки на приложения задаются
 * переменными сборки: пока поддомены не подняты, оба клиента живут на путях
 * /app и /uk, после — на app.liviti.ru и uk.liviti.ru.
 *
 * Позиционирование — B2B-first: главная продаёт платформу управляющим
 * компаниям, а жителю показывает приложение и даёт отдельный вход.
 */
import { LandingNotFound } from './pages/NotFoundPage';
import { Logo } from '@ui/Logo';
import { useSession } from './useSession';
import styles from './styles.module.css';

const RESIDENT_URL = (import.meta.env.VITE_RESIDENT_URL as string | undefined) ?? '/app/';
const STAFF_URL = (import.meta.env.VITE_STAFF_URL as string | undefined) ?? '/uk/';
const DEMO_EMAIL = 'office@liviti.ru';
const DEMO_HREF = `mailto:${DEMO_EMAIL}?subject=${encodeURIComponent('Демонстрация Liviti')}`;

interface Pillar {
  num: string;
  title: string;
  text: string;
  points: string[];
}

const PILLARS: Pillar[] = [
  {
    num: '01',
    title: 'Жителям',
    text: 'Дом в смартфоне: заявки, домофон, гости, камеры и счётчики — в одном приложении.',
    points: ['Заявка с фото за минуту', 'Открытие двери с телефона', 'Гостевой код вместо ключа'],
  },
  {
    num: '02',
    title: 'Управляющим компаниям',
    text: 'Очередь обращений, исполнители, привязки и паспорт дома — в одном кабинете.',
    points: ['Диспетчерская без звонков', 'Подтверждение привязок', 'Квартиры и вызывные панели'],
  },
  {
    num: '03',
    title: 'Инфраструктуре',
    text: 'Домофония, камеры, ворота и доступы работают как одна система, а не набор приложений.',
    points: ['Hikvision, BAS-IP, Akuvox', 'Камеры без открытых портов', 'Один контур доступа'],
  },
];

const INFRA = [
  {
    title: 'Домофония',
    text: 'Звонок с панели приходит в приложение: видно, кто пришёл, дверь открывается одной кнопкой.',
  },
  {
    title: 'Камеры',
    text: 'Обзорные камеры двора и камера вызывной панели — в одном месте, без отдельных логинов.',
  },
  {
    title: 'Ворота и шлагбаумы',
    text: 'Открытие с телефона и гостевые пропуска для тех, кто приезжает на пару часов.',
  },
  {
    title: 'Гостевой доступ',
    text: 'Код для курьера или строителя с ограниченным сроком. Владелец видит, когда им воспользовались.',
  },
];

const STEPS = [
  {
    title: 'Подключаем дом',
    text: 'УК заводит дома и квартиры. Жители привязываются к своей квартире — с подтверждением управляющей компании.',
  },
  {
    title: 'Настраиваем кабинет',
    text: 'Роли, права, категории заявок и сроки SLA. Диспетчер видит очередь, а не переписку в мессенджерах.',
  },
  {
    title: 'Приглашаем жителей',
    text: 'Приложение для жителя, домофон и доступы. Привязку подтверждает УК, чужой доступ не оформить.',
  },
  {
    title: 'Работаем каждый день',
    text: 'Заявки, дверь, камеры и показания — в телефоне. УК работает в кабинете на большом экране.',
  },
];

const RESIDENT_POINTS = [
  'Заявка с фото за минуту',
  'Домофон и открытие двери с телефона',
  'Гостевой код вместо ключа',
  'Камеры двора и подъезда',
  'Показания счётчиков и оплата',
  'Связь с управляющей компанией',
];

const STAFF_POINTS = [
  'Очередь заявок и назначение исполнителей',
  'Карточка заявки с историей и фотоотчётом',
  'Привязки жителей: подтверждение и отказ',
  'Квартиры и номера на вызывной панели',
  'Роли и права: у каждого своё',
  'Кабинет работает с монитора',
];

export function App() {
  // Домашняя страница — только корень. Остальные пути на этом домене
  // Caddy отдаёт как index.html, поэтому 404 показываем сами.
  const isHome = window.location.pathname === '/' || window.location.pathname === '';
  if (!isHome) return <LandingNotFound />;

  return <LandingHome />;
}

/** Отдельный компонент: хуки нельзя вызывать после раннего return. */
function LandingHome() {
  const session = useSession();
  const staffRoles = ['platform_admin', 'uk_admin', 'dispatcher', 'uk_manager', 'executor'];
  const isStaff = session.roles.some((role) => staffRoles.includes(role));
  const cabinetUrl = isStaff ? STAFF_URL : RESIDENT_URL;
  const authenticated = session.status === 'authenticated' && Boolean(session.user);
  const showResidentCta = !authenticated || !isStaff;
  const showStaffCta = !authenticated || isStaff;

  return (
    <>
      <header className={styles.header}>
        <div className={styles.wrap}>
          <div className={styles.headerInner}>
            <a className={styles.brand} href="/">
              <Logo />
            </a>

            <nav className={styles.nav} aria-label="Разделы">
              <a href="#platform">Платформа</a>
              <a href="#uk">Для УК</a>
              <a href="#residents">Жителям</a>
              <a href="#pilots">Объекты</a>
              <a href="#how">Внедрение</a>
              <a href="#demo">Демо</a>
            </nav>

            <div className={styles.actions}>
              {showStaffCta && (
                <a className={`${styles.btn} ${styles.btnGhost}`} href={STAFF_URL}>
                  Кабинет УК
                </a>
              )}
              {authenticated && session.user ? (
                <>
                  <a className={styles.headerUser} href={cabinetUrl} title="Открыть приложение">
                    {session.user.fullName}
                  </a>
                  <button
                    type="button"
                    className={styles.headerLogout}
                    onClick={() => void session.logout()}
                  >
                    Выйти
                  </button>
                </>
              ) : (
                <a className={`${styles.btn} ${styles.btnPrimary}`} href={RESIDENT_URL}>
                  Войти жителю
                </a>
              )}
            </div>
          </div>
        </div>
      </header>

      <section className={styles.hero}>
        <img
          className={styles.heroImage}
          src="/images/nasledie/hero-nasledie-1920.webp"
          srcSet="/images/nasledie/hero-nasledie-800.webp 800w, /images/nasledie/hero-nasledie-1280.webp 1280w, /images/nasledie/hero-nasledie-1920.webp 1920w"
          sizes="100vw"
          alt="Фасад ЖК «Наследие» в Барнауле"
          fetchPriority="high"
        />
        <div className={styles.heroShade} aria-hidden="true" />
        <div className={styles.wrap}>
          <div className={styles.heroGrid}>
            <div>
              <span className={styles.badge}>PropTech-платформа для жилых домов</span>
              <h1>Дом, которым удобно управлять.</h1>
              <p className={styles.heroLead}>Людям — комфорт. Управляющим — контроль.</p>
              <p className={styles.heroText}>
                Единая цифровая экосистема: заявки и диспетчерская, домофония и доступ,
                камеры, счётчики и связь с жителями. От обращения жителя до работы
                диспетчера и управления инфраструктурой.
              </p>

              <div className={styles.heroActions}>
                <a className={`${styles.btn} ${styles.btnPrimary}`} href="#demo">
                  Запросить демонстрацию
                </a>
                {showResidentCta && (
                  <a className={`${styles.btn} ${styles.btnGhost}`} href={RESIDENT_URL}>
                    {authenticated ? 'Открыть приложение' : 'Приложение жителя'}
                  </a>
                )}
              </div>

              <p className={styles.heroNote}>
                Данные хранятся в России. Доступ к квартире выдаёт только подтверждённый
                владелец или управляющая компания. Без выдуманных цифр — покажем продукт
                на вашем доме.
              </p>
            </div>

            <div className={styles.heroVisual}>
              <DashboardMock />
              <PhoneMock />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} id="platform">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionKicker}>Одна платформа</span>
            <h2>Три контура, которые работают вместе</h2>
            <p>
              Житель, сотрудник УК и оборудование дома — не три отдельных сервиса,
              а одна система с общей историей и правами доступа.
            </p>
          </div>

          <div className={styles.cards}>
            {PILLARS.map((pillar) => (
              <article className={styles.pillar} key={pillar.title}>
                <span className={styles.pillarNum}>{pillar.num}</span>
                <h3>{pillar.title}</h3>
                <p>{pillar.text}</p>
                <ul className={styles.pillarList}>
                  {pillar.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.editorial} aria-labelledby="premium-title">
        <div className={styles.editorialMedia}>
          <img
            src="/images/nasledie/evening-nasledie-1200.webp"
            srcSet="/images/nasledie/evening-nasledie-800.webp 800w, /images/nasledie/evening-nasledie-1200.webp 1200w"
            sizes="(max-width: 980px) 100vw, 56vw"
            width={1200}
            height={675}
            alt="ЖК «Наследие» вечером: тёплый свет в окнах"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className={styles.editorialBody}>
          <span className={styles.sectionKicker}>Premium Digital Living</span>
          <h2 id="premium-title">Технологии, которые не спорят с архитектурой</h2>
          <p>
            Liviti не добавляет дому лишних экранов и проводов. Он делает среду
            спокойнее: житель открывает дверь с телефона, диспетчер видит очередь,
            а управляющая компания — историю по каждому дому.
          </p>
          <p className={styles.editorialCaption}>
            ЖК «Наследие», Барнаул · сдача в 2027 году
          </p>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionMuted}`} id="roles">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionKicker}>Один продукт. Два режима</span>
            <h2>Управляющим — контроль. Жителям — комфорт.</h2>
            <p>
              У жителя — телефон и одна минута. У диспетчера — монитор, очередь заявок
              и история по каждому дому. Это разные интерфейсы одной платформы.
            </p>
          </div>

          <div className={styles.twoCols}>
            <article id="uk" className={`${styles.roleCard} ${styles.roleCardDark}`}>
              <span className={styles.roleLabel}>Управляющим компаниям</span>
              <h3>Рабочее место диспетчера</h3>
              <p className={styles.roleLead}>
                Очередь обращений, исполнители, привязки жителей и паспорт дома —
                в одном кабинете.
              </p>
              <ul>
                {STAFF_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <div className={styles.roleActions}>
                <a className={`${styles.btn} ${styles.btnPrimary}`} href={DEMO_HREF}>
                  Запросить демонстрацию
                </a>
                <a className={`${styles.btn} ${styles.btnGhost}`} href={STAFF_URL}>
                  Войти в кабинет
                </a>
              </div>
            </article>

            <article id="residents" className={styles.roleCard}>
              <span className={styles.roleLabel}>Жителям</span>
              <h3>Всё о своей квартире</h3>
              <p className={styles.roleLead}>
                Приложение, которое решает бытовые вопросы без звонков в офис
                и ожидания на линии.
              </p>
              <ul>
                {RESIDENT_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <div className={styles.roleActions}>
                <a className={`${styles.btn} ${styles.btnPrimary}`} href={RESIDENT_URL}>
                  Открыть приложение
                </a>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className={styles.section} id="infrastructure">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionKicker}>Инфраструктура</span>
            <h2>Оборудование дома — в одном контуре</h2>
            <p>
              Домофония, камеры, ворота и гостевой доступ не требуют отдельных
              приложений и логинов. Оборудование может быть уже установлено.
            </p>
          </div>

          <div className={styles.infraFeature}>
            <div className={styles.infraMedia}>
              <img
                src="/images/nasledie/gate-nasledie-800.webp"
                width={800}
                height={565}
                alt="Въезд во двор ЖК «Наследие»"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className={styles.infraGrid}>
              {INFRA.map((item) => (
                <article className={styles.infraItem} key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.details} id="details">
        <div className={styles.detailsMedia}>
          <img
            className={styles.detailsWide}
            src="/images/nasledie/parking-nasledie-1200.webp"
            alt="Подземный паркинг ЖК «Наследие»"
            loading="lazy"
            decoding="async"
          />
          <img
            className={styles.detailsPortrait}
            src="/images/nasledie/lobby-nasledie-1000.webp"
            alt="Входная группа ЖК «Наследие»"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className={styles.detailsBody}>
          <span className={styles.sectionKicker}>Детали Premium Living</span>
          <h2>Дом чувствуется в деталях</h2>
          <p>
            Паркинг с мягким светом, спокойная входная группа и дверь, которая
            открывается с телефона. Liviti связывает эти сценарии в один продукт,
            не добавляя дому визуального шума.
          </p>
          <p className={styles.editorialCaption}>ЖК «Наследие», Барнаул</p>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionMuted}`} id="how">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionKicker}>Внедрение</span>
            <h2>От дома к работающему сервису — четыре шага</h2>
            <p>
              Подключаем один дом, настраиваем кабинет и приглашаем жителей.
              Дальше платформа работает вместе с вашей командой.
            </p>
          </div>

          <div className={styles.steps}>
            {STEPS.map((step, index) => (
              <article className={styles.step} key={step.title}>
                <div className={styles.stepNum}>{index + 1}</div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} id="security">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionKicker}>Безопасность и контроль</span>
            <h2>Доступ только у тех, кому он выдан</h2>
            <p>
              Права проверяются на сервере, а не в интерфейсе. Данные, привязки
              и инфраструктура дома остаются под контролем УК.
            </p>
          </div>

          <div className={styles.trust}>
            <div className={styles.trustItem}>
              <strong>Данные в России</strong>
              Серверы и резервные копии — на территории РФ.
            </div>
            <div className={styles.trustItem}>
              <strong>Доступ по подтверждению</strong>
              Квартиру привязывает УК, а не сам житель.
            </div>
            <div className={styles.trustItem}>
              <strong>Без открытых портов</strong>
              Камеры и панели не смотрят в интернет.
            </div>
            <div className={styles.trustItem}>
              <strong>Роли и права</strong>
              У диспетчера, исполнителя и жителя — разные наборы действий.
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} id="pilots">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionKicker}>Пилотные объекты</span>
            <h2>Барнаул, 2027</h2>
            <p>
              На этих объектах мы отвечаем за электрику, пожарную безопасность,
              СКУД и домофонию. Здесь планируем внедрить Liviti.
            </p>
          </div>

          <div className={styles.pilotGrid}>
            <article className={styles.pilotCard}>
              <div className={styles.pilotMedia}>
                <img
                  src="/images/nasledie/autumn-nasledie-936.webp"
                  width={936}
                  height={530}
                  alt="ЖК «Наследие» в Барнауле осенью"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className={styles.pilotBody}>
                <span className={styles.pilotLabel}>ЖК «Наследие»</span>
                <h3>Чкалова, 56–58</h3>
                <p>Сдача в 2027 году. Планируем внедрить Liviti.</p>
              </div>
            </article>

            <article className={styles.pilotCard}>
              <div className={styles.pilotMedia}>
                <img
                  src="/images/nasledie/burevestnik-1200.webp"
                  srcSet="/images/nasledie/burevestnik-800.webp 800w, /images/nasledie/burevestnik-1200.webp 1200w, /images/nasledie/burevestnik-1600.webp 1600w"
                  sizes="(max-width: 640px) 100vw, 50vw"
                  width={1600}
                  height={900}
                  alt="ЖК «Буревестник» в Барнауле"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className={styles.pilotBody}>
                <span className={styles.pilotLabel}>ЖК «Буревестник»</span>
                <h3>Анатолия, 52</h3>
                <p>Сдача в 2027 году. Планируем внедрить Liviti.</p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className={styles.cta} id="demo">
        <div className={styles.wrap}>
          <div className={styles.ctaBox}>
            <div>
              <span className={styles.sectionKicker}>Демонстрация</span>
              <h2>Покажем Liviti на вашем доме</h2>
              <p>
                Подключим один дом, настроим привязки и покажем, как это выглядит
                для жителя и для диспетчера. Дальше решаете вы.
              </p>
              <p className={styles.demoNote}>
                Или напишите на{' '}
                <a href={`mailto:${DEMO_EMAIL}`}>{DEMO_EMAIL}</a> — ответим и
                предложим время.
              </p>
            </div>
            <div className={styles.demoActions}>
              <a className={`${styles.btn} ${styles.btnPrimary}`} href={DEMO_HREF}>
                Запросить демонстрацию
              </a>
              <a className={`${styles.btn} ${styles.btnGhost}`} href={STAFF_URL}>
                Войти в кабинет УК
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.wrap}>
          <div className={styles.footerInner}>
            <span>© 2026 liviti · цифровая среда для современной жизни</span>
            <div className={styles.footerLinks}>
              <a href={RESIDENT_URL}>Приложение жителя</a>
              <a href={STAFF_URL}>Кабинет УК</a>
              <a href="#platform">Платформа</a>
              <a href="#demo">Демонстрация</a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}

function DashboardMock() {
  return (
    <div className={styles.dashboardMock} aria-hidden="true">
      <div className={styles.dashTop}>
        <span className={styles.dashBrand}>
          <Logo variant="mark" size="sm" />
          liviti · кабинет УК
        </span>
        <span className={styles.dashDemo}>демо</span>
      </div>
      <div className={styles.dashHead}>
        <strong>Инбокс</strong>
        <span>демо-данные</span>
      </div>
      <div className={styles.dashRows}>
        <div className={styles.dashRow}>
          <span>№128 · Протечка в подвале</span>
          <span className={styles.dashStatus}>В работе</span>
        </div>
        <div className={styles.dashRow}>
          <span>№127 · Не работает домофон</span>
          <span className={styles.dashStatus}>Новая</span>
        </div>
        <div className={styles.dashRow}>
          <span>№126 · Засор в стояке</span>
          <span className={styles.dashStatusWarn}>Просрочена</span>
        </div>
        <div className={styles.dashRow}>
          <span>№125 · Счётчики за месяц</span>
          <span className={styles.dashStatus}>Закрыта</span>
        </div>
      </div>
      <div className={styles.dashFoot}>
        <span>Очередь на сегодня</span>
        <strong>4 обращения</strong>
      </div>
    </div>
  );
}

function PhoneMock() {
  return (
    <div className={styles.phone} aria-hidden="true">
      <div className={styles.phoneScreen}>
        <div className={styles.phoneTop}>
          <span>9:41</span>
          <span>liviti</span>
        </div>

        <div>
          <div className={styles.phoneTitle}>Подъезд 1</div>
          <div className={styles.callMeta}>Вызывная панель · 12 секунд</div>
        </div>

        <div className={styles.callCard}>
          <div className={styles.callName}>Курьер</div>
          <div className={styles.callMeta}>Нажмите «Открыть», чтобы впустить</div>
          <div className={styles.callActions}>
            <button className={`${styles.miniBtn} ${styles.miniPrimary}`} type="button">
              Открыть
            </button>
            <button className={`${styles.miniBtn} ${styles.miniGhost}`} type="button">
              Отклонить
            </button>
          </div>
        </div>

        <div className={styles.rows}>
          <div className={styles.row}>
            <span>
              <span className={styles.rowDot} />
              Заявка №128
            </span>
            <span>в работе</span>
          </div>
          <div className={styles.row}>
            <span>
              <span className={styles.rowDot} />
              Счётчики
            </span>
            <span>переданы</span>
          </div>
          <div className={styles.row}>
            <span>
              <span className={styles.rowDot} />
              Гостевой код
            </span>
            <span>до 09.11</span>
          </div>
        </div>
      </div>
    </div>
  );
}
