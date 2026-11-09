import { Fragment, useState, type ReactNode } from 'react';
import { Alert } from '@ui/Alert';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { Card } from '@ui/Card';
import { Checkbox } from '@ui/Checkbox';
import { DataTable, type DataTableColumn } from '@ui/DataTable';
import { Drawer } from '@ui/Drawer';
import { EmptyState } from '@ui/EmptyState';
import { Field } from '@ui/Field';
import { FilterBar } from '@ui/FilterBar';
import { Logo } from '@ui/Logo';
import { Modal } from '@ui/Modal';
import { Pagination } from '@ui/Pagination';
import { Popover } from '@ui/Popover';
import { Radio } from '@ui/Radio';
import { Select } from '@ui/Select';
import { Skeleton } from '@ui/Skeleton';
import { StatusBadge } from '@ui/StatusBadge';
import { Switch } from '@ui/Switch';
import { Tabs, type TabItem } from '@ui/Tabs';
import { TextArea } from '@ui/TextArea';
import { TicketCard } from '@ui/TicketCard';
import { Toast } from '@ui/Toast';
import { Tooltip } from '@ui/Tooltip';
import { ResidentShell } from '@ui/layouts/ResidentShell';
import { StaffShell } from '@ui/layouts/StaffShell';
import type { TicketStatus, TicketSummary } from '@shared/types';
import styles from './App.module.css';

type SectionId =
  | 'foundations'
  | 'shells'
  | 'buttons'
  | 'forms'
  | 'statuses'
  | 'feedback'
  | 'data'
  | 'overlays'
  | 'accessibility';

interface SectionMeta {
  id: SectionId;
  label: string;
  group: string;
}

const SECTIONS: SectionMeta[] = [
  { id: 'foundations', label: 'Foundation', group: 'Основа' },
  { id: 'shells', label: 'Shells: житель / УК', group: 'Паттерны' },
  { id: 'buttons', label: 'Button', group: 'Компоненты' },
  { id: 'forms', label: 'Input, Select, Switch', group: 'Компоненты' },
  { id: 'statuses', label: 'Badge, Status, Card', group: 'Компоненты' },
  { id: 'feedback', label: 'Alert, Toast, Skeleton', group: 'Компоненты' },
  { id: 'data', label: 'Data Table, Tabs', group: 'Компоненты' },
  { id: 'overlays', label: 'Modal', group: 'Компоненты' },
  { id: 'accessibility', label: 'Доступность', group: 'Проверки' },
];

type Viewport = 'auto' | '360' | '390' | '768';

const COLORS = [
  { name: 'Deep Ink', token: '--liviti-ink', value: '#142b35' },
  { name: 'Liviti Green', token: '--liviti-green', value: '#285b50' },
  { name: 'Soft Lime', token: '--liviti-lime', value: '#c5e58a' },
  { name: 'Soft Paper', token: '--bg', value: '#f5f7f3' },
  { name: 'Pure White', token: '--surface', value: '#ffffff' },
  { name: 'Dark Text', token: '--text-primary', value: '#202d30' },
  { name: 'Secondary Text', token: '--text-secondary', value: '#65736f' },
  { name: 'Soft Border', token: '--border', value: '#e3e9e3' },
  { name: 'Success', token: '--status-done', value: '#2f6b48' },
  { name: 'Warning', token: '--status-progress', value: '#8a5a1f' },
  { name: 'Danger', token: '--status-rejected', value: '#a83e39' },
  { name: 'Info', token: '--status-new', value: '#35657f' },
];

const TYPE_SCALE = [
  { name: 'Display', size: '56px', weight: 700, font: 'heading' as const, sample: 'Дом, которым удобно управлять' },
  { name: 'H1', size: '32px', weight: 700, font: 'heading' as const, sample: 'Заявки по вашему дому' },
  { name: 'H2', size: '26px', weight: 700, font: 'heading' as const, sample: 'Активные обращения' },
  { name: 'H3', size: '21px', weight: 700, font: 'heading' as const, sample: 'Не работает домофон' },
  { name: 'Body L', size: '16px', weight: 400, font: 'body' as const, sample: 'Создайте заявку и следите за её статусом.' },
  { name: 'Body', size: '14px', weight: 400, font: 'body' as const, sample: 'Основной текст интерфейса.' },
  { name: 'Caption', size: '12px', weight: 500, font: 'body' as const, sample: 'Подпись к полю' },
];

const SPACES = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64];
const RADII = [
  ['sm', 8],
  ['md', 12],
  ['lg', 16],
  ['xl', 22],
  ['2xl', 28],
] as const;
const SHADOWS = [
  ['sm', 'var(--shadow-sm)'],
  ['md', 'var(--shadow-md)'],
  ['lg', 'var(--shadow-lg)'],
] as const;

const BADGES = [
  { variant: 'success' as const, label: 'Активен' },
  { variant: 'warning' as const, label: 'Ожидает' },
  { variant: 'danger' as const, label: 'Ошибка' },
  { variant: 'info' as const, label: 'Информация' },
  { variant: 'neutral' as const, label: 'Закрыт' },
];

const STATUSES: TicketStatus[] = [
  'new',
  'accepted',
  'assigned',
  'in_progress',
  'waiting',
  'done',
  'closed',
  'rejected',
];

const MOCK_TICKET: TicketSummary = {
  id: 'ticket-1048',
  number: 1048,
  status: { code: 'in_progress', name: 'В работе' },
  priority: 'high',
  source: 'dispatcher_phone',
  category: { id: 'category-intercom', name: 'Домофон' },
  building: { id: 'building-1', addressText: 'ул. Ленина, 1' },
  apartment: { id: 'apartment-42', number: '42' },
  title: 'Не работает домофон',
  assignedTo: { id: 'user-ivanov', fullName: 'Иванов И.' },
  slaDueAt: null,
  isOverdue: false,
  createdAt: new Date().toISOString(),
};

const STAFF_ROWS: { number: number; title: string; house: string; status: TicketStatus }[] = [
  { number: 1048, title: 'Не работает домофон', house: 'Дом 8', status: 'in_progress' },
  { number: 1047, title: 'Нет отопления', house: 'Дом 12', status: 'new' },
  { number: 1046, title: 'Перегорела лампа', house: 'Дом 4', status: 'closed' },
  { number: 1045, title: 'Протечка кровли', house: 'Дом 8', status: 'assigned' },
];

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const high = Math.max(first, second);
  const low = Math.min(first, second);
  return (high + 0.05) / (low + 0.05);
}

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.lead}>{lead}</p>
      {children}
    </section>
  );
}

function Foundations() {
  return (
    <Section
      title="Foundation"
      lead="Цвета, типографика, отступы, радиусы и тени. Это единственный источник значений для компонентов; контраст считается к белому и к Soft Paper."
    >
      <div className={styles.subsection}>
        <h2 className={styles.subtitle}>Цвета</h2>
        <div className={styles.swatchGrid}>
          {COLORS.map((color) => {
            const onWhite = contrast(color.value, '#ffffff');
            const onPaper = contrast(color.value, '#f5f7f3');
            return (
              <button
                key={color.token}
                type="button"
                className={styles.swatch}
                onClick={() => void navigator.clipboard?.writeText(`var(${color.token})`)}
                aria-label={`Скопировать ${color.name}: var(${color.token})`}
              >
                <span className={styles.swatchColor} style={{ background: `var(${color.token})` }} />
                <span className={styles.swatchBody}>
                  <strong>{color.name}</strong>
                  <span>{color.value}</span>
                  <code>var({color.token})</code>
                  <span className={styles.swatchContrast}>
                    на белом {onWhite.toFixed(1)} · на бумаге {onPaper.toFixed(1)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.subsection}>
        <h2 className={styles.subtitle}>Типографика</h2>
        <div className={styles.typeList}>
          {TYPE_SCALE.map((item) => (
            <div key={item.name} className={styles.typeRow}>
              <span className={styles.typeMeta}>
                {item.name}
                <br />
                {item.size} · {item.weight}
              </span>
              <span
                style={{
                  fontFamily: `var(--font-${item.font})`,
                  fontSize: item.size,
                  fontWeight: item.weight,
                  lineHeight: 1.15,
                }}
              >
                {item.sample}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.subsection}>
        <h2 className={styles.subtitle}>Отступы и радиусы</h2>
        <div className={styles.row}>
          {SPACES.map((space) => (
            <div key={space} className={styles.space}>
              <span className={styles.spaceBox} style={{ width: space, height: space }} />
              <span>{space}</span>
            </div>
          ))}
        </div>
        <div className={styles.row}>
          {RADII.map(([name, value]) => (
            <div key={name} className={styles.radius}>
              <span className={styles.radiusBox} style={{ borderRadius: value }} />
              <span>
                {name} · {value}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.subsection}>
        <h2 className={styles.subtitle}>Тени</h2>
        <div className={styles.row}>
          {SHADOWS.map(([name, shadow]) => (
            <div key={name} className={styles.shadow} style={{ boxShadow: shadow }}>
              shadow-{name}
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function ResidentDemo() {
  return (
    <div className={styles.demoStack}>
      <Card className={styles.demoHero}>
        <span className={styles.muted}>Здравствуйте,</span>
        <h2>Иван Иванович</h2>
        <span className={styles.muted}>г. Барнаул, ул. Ленина, 1, кв. 1</span>
        <Button size="sm" variant="ghost">
          + Добавить квартиру
        </Button>
      </Card>

      <div className={styles.demoActions}>
        <Card className={styles.demoCard}>
          <strong>Подъезд 1</strong>
          <span className={styles.muted}>Открыть дверь</span>
          <Button size="sm" variant="outline">
            Открыть
          </Button>
        </Card>
        <Card className={styles.demoCard}>
          <strong>Шлагбаум на въезде</strong>
          <span className={styles.muted}>Открыть шлагбаум</span>
          <Button size="sm" variant="outline">
            Открыть
          </Button>
        </Card>
      </div>

      <h3 className={styles.demoTitle}>Сервисы</h3>
      <div className={styles.serviceGrid}>
        {[
          ['Заявки и жалобы', 'Сантехника, электрика, двор'],
          ['Двери и шлагбаум', 'Подъезд, калитка, въезд'],
          ['Видеонаблюдение', 'Камеры двора и подъезда'],
          ['Показания счётчиков', 'Вода и электричество'],
        ].map(([title, description]) => (
          <Card key={title} className={styles.demoCard}>
            <span className={styles.serviceDot} aria-hidden="true" />
            <strong>{title}</strong>
            <span className={styles.muted}>{description}</span>
          </Card>
        ))}
      </div>

      <h3 className={styles.demoTitle}>Ваши заявки</h3>
      <div className={styles.demoStack}>
        {[
          { number: 29, title: 'Водоснабжение', status: 'new' as TicketStatus },
          { number: 26, title: 'Лифтовое оборудование', status: 'in_progress' as TicketStatus },
        ].map((ticket) => (
          <Card key={ticket.number} className={styles.demoTicket}>
            <div className={styles.demoTicketTop}>
              <StatusBadge code={ticket.status} />
              <span className={styles.muted}>№{ticket.number}</span>
            </div>
            <strong>{ticket.title}</strong>
            <span className={styles.muted}>г. Барнаул, ул. Ленина, 1, кв. 1</span>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StaffDemo() {
  return (
    <div className={styles.demoStack}>
      <div className={styles.filterBar}>
        <Button size="sm" variant="primary">
          Все
        </Button>
        <Button size="sm" variant="outline">
          Новые
        </Button>
        <Button size="sm" variant="outline">
          В работе
        </Button>
        <Button size="sm" variant="outline">
          Просроченные
        </Button>
        <span className={styles.muted}>28 заявок</span>
      </div>

      <div className={styles.dataTable} role="table" aria-label="Заявки">
        <div className={styles.tableHead} role="row">
          <span>№</span>
          <span>Обращение</span>
          <span className={styles.colHouse}>Дом</span>
          <span>Статус</span>
        </div>
        {STAFF_ROWS.map((row) => (
          <div className={styles.tableRow} role="row" key={row.number}>
            <span>{row.number}</span>
            <span className={styles.tableTitle}>{row.title}</span>
            <span className={styles.colHouse}>{row.house}</span>
            <span>
              <StatusBadge code={row.status} />
            </span>
          </div>
        ))}
      </div>

      <Card className={styles.demoNote}>
        <strong>Плотность УК</strong>
        <span className={styles.muted}>
          Та же палитра, но тёмный каркас, компактные строки и таблица вместо карточек. Это и
          отличает продукт.
        </span>
      </Card>
    </div>
  );
}

function Shells() {
  const [mode, setMode] = useState<'resident' | 'staff'>('resident');

  return (
    <Section
      title="Shells: житель и УК"
      lead="Один бренд, два режима. У жителя светлый бумажный каркас и крупные карточки; у УК — Deep Ink-сайдбар, плотная таблица и компактные действия. Цвет бренда один, отличие — в композиции."
    >
      <div className={styles.controls}>
        <div className={styles.control}>
          <span>Каркас</span>
          <div className={styles.segmented}>
            <button
              type="button"
              aria-pressed={mode === 'resident'}
              onClick={() => setMode('resident')}
            >
              Житель
            </button>
            <button
              type="button"
              aria-pressed={mode === 'staff'}
              onClick={() => setMode('staff')}
            >
              Кабинет УК
            </button>
          </div>
        </div>
      </div>

      <div className={styles.shellStage}>
        {mode === 'resident' ? (
          <ResidentShell userName="Иван Иванович" address="ул. Ленина, 1 · кв. 1">
            <ResidentDemo />
          </ResidentShell>
        ) : (
          <StaffShell tenantName="Дом-Сервис" userName="Диспетчер Дом-Сервис">
            <StaffDemo />
          </StaffShell>
        )}
      </div>
    </Section>
  );
}

function Buttons() {
  const [variant, setVariant] = useState<'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'>(
    'primary',
  );
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [loading, setLoading] = useState(false);
  const [disabled, setDisabled] = useState(false);

  return (
    <Section
      title="Button"
      lead="Основное действие — одно на экран. На телефоне высота 48 px; компактные действия УК — 40 px с областью нажатия 44 px."
    >
      <div className={styles.controls}>
        <div className={styles.control}>
          <span>Вариант</span>
          <div className={styles.segmented}>
            {(['primary', 'secondary', 'outline', 'ghost', 'danger'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={variant === value}
                onClick={() => setVariant(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.control}>
          <span>Размер</span>
          <div className={styles.segmented}>
            {(['sm', 'md', 'lg'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={size === value}
                onClick={() => setSize(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={loading} onChange={(event) => setLoading(event.target.checked)} />
          Loading
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={disabled}
            onChange={(event) => setDisabled(event.target.checked)}
          />
          Disabled
        </label>
      </div>

      <div className={styles.preview}>
        <Button variant={variant} size={size} loading={loading} disabled={disabled}>
          Создать заявку
        </Button>
      </div>

      <div className={styles.subsection}>
        <h2 className={styles.subtitle}>Все варианты</h2>
        <div className={styles.row}>
          <Button variant="primary">Основная</Button>
          <Button variant="secondary">Второстепенная</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Опасная</Button>
        </div>
        <div className={styles.darkPanel}>
          <span>Акцентная кнопка — только на тёмной поверхности</span>
          <Button variant="accent">Подключить дом</Button>
        </div>
      </div>

      <div className={styles.subsection}>
        <h2 className={styles.subtitle}>Размеры</h2>
        <div className={styles.row}>
          <Button size="sm">Small · 32</Button>
          <Button size="md">Medium · 40</Button>
          <Button size="lg">Large · 48</Button>
          <Button compact>Compact УК</Button>
        </div>
      </div>
    </Section>
  );
}

function Forms() {
  const [phone, setPhone] = useState('+7 913 555-01');
  const [comment, setComment] = useState('');
  const [error, setError] = useState(false);
  const [house, setHouse] = useState('12');
  const [notify, setNotify] = useState(true);
  const [all, setAll] = useState(false);
  const [channel, setChannel] = useState('push');
  const [guest, setGuest] = useState(false);

  return (
    <Section
      title="Input, Select, Switch"
      lead="Label всегда виден, placeholder не заменяет название поля. Ошибка объясняет, что исправить, и связана с полем через aria-describedby. Checkbox/Radio/Switch — нативные или с корректной ролью."
    >
      <div className={styles.formGrid}>
        <Field
          label="Телефон"
          required
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          hint="Мы отправим код подтверждения"
          error={error ? 'Введите номер полностью: +7 и 10 цифр' : null}
          onChange={(event) => setPhone(event.target.value)}
        />
        <Select
          label="Дом"
          value={house}
          onChange={(event) => setHouse(event.target.value)}
          hint="Можно выбрать другой объект"
        >
          <option value="12">Дом № 12 · ул. Садовая, 12</option>
          <option value="8">Дом № 8 · ул. Лесная, 8</option>
          <option value="4">Дом № 4 · ул. Новая, 4</option>
        </Select>
        <Field label="E-mail" type="email" placeholder="name@example.com" hint="Необязательно" />
        <Field label="Отключённое поле" value="Недоступно" disabled readOnly />
        <TextArea
          label="Комментарий"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          hint="Что случилось?"
          showCounter
          rows={4}
        />
      </div>

      <div className={styles.controlStack}>
        <Checkbox
          label="Уведомлять об изменении статуса"
          description="Push и e-mail, если они включены в профиле"
          checked={notify}
          onChange={(event) => {
            setNotify(event.target.checked);
            if (!event.target.checked) setAll(false);
          }}
        />
        <Checkbox
          label="Выбрать все уведомления"
          description="Независимый выбор нескольких значений"
          checked={all}
          indeterminate={!all && notify}
          onChange={(event) => {
            setAll(event.target.checked);
            setNotify(event.target.checked);
          }}
        />
        <Checkbox label="Недоступный вариант" disabled />
        <div className={styles.choiceGroup}>
          <span className={styles.choiceLabel}>Способ связи</span>
          <Radio
            name="channel"
            value="push"
            label="Push"
            description="Быстро и без SMS"
            checked={channel === 'push'}
            onChange={() => setChannel('push')}
          />
          <Radio
            name="channel"
            value="sms"
            label="SMS"
            description="Если push недоступен"
            checked={channel === 'sms'}
            onChange={() => setChannel('sms')}
          />
        </div>
        <Switch
          checked={guest}
          onChange={setGuest}
          label="Гостевой доступ"
          description="Разрешить гостю открывать двери по коду"
        />
      </div>

      <div className={styles.row}>
        <Button variant="outline" size="sm" onClick={() => setError((value) => !value)}>
          {error ? 'Скрыть ошибку' : 'Показать ошибку'}
        </Button>
      </div>
    </Section>
  );
}

function Statuses() {
  return (
    <Section
      title="Badge, Status, Card"
      lead="Статус всегда передаётся текстом и цветом. Цветной текст на пастельном фоне затемнён, чтобы проходить AA для мелкого текста."
    >
      <div className={styles.subsection}>
        <h2 className={styles.subtitle}>Badge</h2>
        <div className={styles.row}>
          {BADGES.map((badge) => (
            <Badge key={badge.variant} variant={badge.variant}>
              {badge.label}
            </Badge>
          ))}
        </div>
      </div>

      <div className={styles.subsection}>
        <h2 className={styles.subtitle}>Статусы заявок</h2>
        <div className={styles.row}>
          {STATUSES.map((code) => (
            <StatusBadge key={code} code={code} />
          ))}
        </div>
      </div>

      <div className={styles.subsection}>
        <h2 className={styles.subtitle}>Card и TicketCard</h2>
        <div className={styles.cardGrid}>
          <Card>
            <span className={styles.muted}>Активные заявки</span>
            <span className={styles.stat}>24</span>
            <span className={styles.muted}>В работе сейчас</span>
          </Card>
          <TicketCard ticket={MOCK_TICKET} onOpen={() => undefined} />
        </div>
      </div>
    </Section>
  );
}

function Feedback() {
  const [toast, setToast] = useState<{ variant: 'success' | 'danger' | 'info'; text: string } | null>(
    null,
  );

  const showToast = (variant: 'success' | 'danger' | 'info', text: string) => {
    setToast({ variant, text });
    window.setTimeout(() => setToast(null), 4000);
  };

  return (
    <Section
      title="Alert, Toast, Skeleton, Empty"
      lead="Обратная связь должна объяснять, что произошло и что делать дальше. Ошибка не исчезает сама; toast закрывается через 4 секунды."
    >
      <div className={styles.row}>
        <Button onClick={() => showToast('success', 'Заявка создана')}>Показать toast</Button>
        <Button variant="danger" onClick={() => showToast('danger', 'Не удалось сохранить. Повторите.')}>
          Показать ошибку
        </Button>
        <Button variant="outline" onClick={() => showToast('info', 'Список обновляется раз в минуту')}>
          Показать info
        </Button>
      </div>

      <div className={styles.feedbackGrid}>
        <Alert variant="info" title="Обновление данных">
          Список обновляется раз в минуту.
        </Alert>
        <Alert variant="success" title="Изменения сохранены">
          Жители увидят их сразу.
        </Alert>
        <Alert variant="warning" title="Часть данных недоступна">
          Показаны последние известные значения.
        </Alert>
        <Alert variant="danger" title="Не удалось отправить">
          Повторите попытку или напишите в поддержку.
        </Alert>
      </div>

      <div className={styles.feedbackGrid}>
        <Card>
          <span className={styles.muted}>Skeleton</span>
          <div className={styles.skeletonStack}>
            <Skeleton width="60%" height={18} />
            <Skeleton />
            <Skeleton width="80%" />
          </div>
        </Card>
        <Card>
          <EmptyState
            icon="○"
            title="Пока нет заявок"
            description="Здесь будут обращения жителей вашего дома."
            action={<Button size="sm">Создать заявку</Button>}
          />
        </Card>
      </div>

      {toast && (
        <Toast variant={toast.variant} onClose={() => setToast(null)}>
          {toast.text}
        </Toast>
      )}
    </Section>
  );
}

function DataSection() {
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [density, setDensity] = useState<'compact' | 'default' | 'comfortable'>('default');
  const [tab, setTab] = useState('overview');
  const [page, setPage] = useState(3);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');

  const columns: DataTableColumn<(typeof STAFF_ROWS)[number]>[] = [
    {
      key: 'number',
      header: '№',
      width: '64px',
      sortable: true,
      render: (row) => row.number,
    },
    {
      key: 'title',
      header: 'Обращение',
      sortable: true,
      render: (row) => <strong>{row.title}</strong>,
    },
    {
      key: 'house',
      header: 'Дом',
      hideOnMobile: true,
      render: (row) => row.house,
    },
    {
      key: 'status',
      header: 'Статус',
      sortable: true,
      render: (row) => <StatusBadge code={row.status} />,
    },
  ];

  const rows = STAFF_ROWS.filter((row) => {
    const matchesStatus = status === 'all' || row.status === status;
    const haystack = `${row.number} ${row.title} ${row.house}`.toLowerCase();
    const matchesQuery = query.trim() === '' || haystack.includes(query.toLowerCase().trim());
    return matchesStatus && matchesQuery;
  });

  if (sort) {
    rows.sort((a, b) => {
      const left = sort.key === 'number' ? a.number : sort.key === 'status' ? a.status : a.title;
      const right = sort.key === 'number' ? b.number : sort.key === 'status' ? b.status : b.title;
      return String(left).localeCompare(String(right), 'ru') * (sort.direction === 'asc' ? 1 : -1);
    });
  }

  const tabs: TabItem[] = [
    {
      id: 'overview',
      label: 'Обзор',
      content: (
        <Card className={styles.demoCard}>
          <strong>Сводка по дому</strong>
          <span className={styles.muted}>28 заявок, 3 просрочены, 12 в работе.</span>
        </Card>
      ),
    },
    {
      id: 'history',
      label: 'История',
      content: (
        <Card className={styles.demoCard}>
          <strong>Последние события</strong>
          <span className={styles.muted}>Заявка №1048 назначена Иванову И.</span>
        </Card>
      ),
    },
    {
      id: 'settings',
      label: 'Настройки',
      content: (
        <Card className={styles.demoCard}>
          <strong>Параметры таблицы</strong>
          <span className={styles.muted}>Плотность, столбцы и сохранённые фильтры.</span>
        </Card>
      ),
    },
  ];

  return (
    <Section
      title="Data Table, Tabs, Pagination"
      lead="Таблица умеет сортировку, поиск, фильтры, выбор строк и мобильные карточки. Tabs и Pagination — с клавиатурой и aria; Tooltip — только для дополнительной подсказки."
    >
      <FilterBar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Поиск по номеру, теме или дому"
        filters={[
          {
            id: 'status',
            label: 'Статус',
            value: status,
            onChange: setStatus,
            options: [
              { value: 'all', label: 'Все статусы' },
              { value: 'new', label: 'Новые' },
              { value: 'in_progress', label: 'В работе' },
              { value: 'assigned', label: 'Назначен исполнитель' },
              { value: 'closed', label: 'Закрытые' },
            ],
          },
        ]}
        resultCount={rows.length}
        onReset={() => {
          setQuery('');
          setStatus('all');
        }}
      />

      <div className={styles.controls}>
        <div className={styles.control}>
          <span>Плотность</span>
          <div className={styles.segmented}>
            {(['compact', 'default', 'comfortable'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={density === value}
                onClick={() => setDensity(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <span className={styles.muted}>Выбрано: {selected.length}</span>
        {selected.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Снять выбор
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => String(row.number)}
        density={density}
        ariaLabel="Заявки"
        sort={sort}
        onSort={(key) =>
          setSort((current) =>
            current?.key === key
              ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
              : { key, direction: 'asc' },
          )
        }
        selectedKeys={selected}
        onToggleRow={(key) =>
          setSelected((current) =>
            current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
          )
        }
        onToggleAll={() =>
          setSelected((current) =>
            current.length === rows.length ? [] : rows.map((row) => String(row.number)),
          )
        }
        empty={
          <EmptyState
            title="Заявок пока нет"
            description="Здесь появятся обращения жителей."
            action={<Button size="sm">Создать заявку</Button>}
          />
        }
      />

      <div className={styles.subsection}>
        <h2 className={styles.subtitle}>Tabs</h2>
        <Tabs items={tabs} value={tab} onChange={setTab} label="Разделы карточки" />
      </div>

      <div className={styles.demoRow}>
        <Tooltip label="Показать краткую справку по разделу">
          <Button size="sm" variant="outline">
            Что это?
          </Button>
        </Tooltip>
        <Pagination page={page} pageCount={5} onChange={setPage} />
      </div>
    </Section>
  );
}

function Overlays() {
  const [open, setOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>('md');

  return (
    <Section
      title="Modal, Drawer, Popover"
      lead="Modal — для короткой формы, Drawer — для деталей без потери списка, Popover — для небольших контекстных действий. У Modal и Drawer общий focus trap, Escape и возврат фокуса."
    >
      <div className={styles.controls}>
        <div className={styles.control}>
          <span>Размер Modal</span>
          <div className={styles.segmented}>
            {(['sm', 'md', 'lg'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={size === value}
                onClick={() => setSize(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.row}>
        <Button onClick={() => setOpen(true)}>Открыть Modal</Button>
        <Button variant="outline" onClick={() => setDrawer(true)}>
          Открыть Drawer
        </Button>
        <Popover
          label="Действия с заявкой"
          trigger={
            <Button size="sm" variant="ghost">
              Действия
            </Button>
          }
        >
          <div className={styles.popoverStack}>
            <Button size="sm" variant="ghost">Назначить исполнителя</Button>
            <Button size="sm" variant="ghost">Изменить статус</Button>
            <Button size="sm" variant="ghost">Скопировать номер</Button>
          </div>
        </Popover>
      </div>

      {open && (
        <Modal title="Новая заявка" size={size} onClose={() => setOpen(false)}>
          <div className={styles.formGrid}>
            <Field label="Что случилось" placeholder="Например, не работает домофон" />
            <TextArea label="Комментарий" placeholder="Детали для диспетчера" />
          </div>
          <div className={styles.modalActions}>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => setOpen(false)}>Создать заявку</Button>
          </div>
        </Modal>
      )}

      {drawer && (
        <Drawer title="Заявка №1048" onClose={() => setDrawer(false)}>
          <div className={styles.demoStack}>
            <StatusBadge code="in_progress" />
            <strong>Не работает домофон</strong>
            <span className={styles.muted}>Дом 8 · подъезд 2 · создана сегодня, 10:42</span>
            <span className={styles.muted}>Исполнитель: Иванов И.</span>
            <Button size="sm" onClick={() => setDrawer(false)}>
              Открыть полностью
            </Button>
          </div>
        </Drawer>
      )}
    </Section>
  );
}

function Accessibility() {
  return (
    <Section
      title="Доступность"
      lead="Ориентир — WCAG 2.2 AA. Это не галочка в документе, а проверки, которые должны проходить компоненты и экраны."
    >
      <div className={styles.a11yGrid}>
        <Card>
          <h3>Контраст</h3>
          <p className={styles.muted}>
            Обычный текст — 4.5:1, крупный — 3:1, границы и фокус — 3:1. Secondary-текст в этой
            теме — #65736F, он проходит на бумаге и белом. Lime используется только на тёмном.
          </p>
        </Card>
        <Card>
          <h3>Фокус</h3>
          <p className={styles.muted}>
            Проверьте Tab: кольцо должно быть видимым и не перекрываться sticky-шапкой или нижней
            навигацией. Глобальный стиль — 3 px с offset 2 px.
          </p>
          <Button variant="outline" size="sm">
            Кнопка для Tab
          </Button>
        </Card>
        <Card>
          <h3>Цели взаимодействия</h3>
          <p className={styles.muted}>
            Минимум WCAG — 24×24, цель Liviti — 44×44. Компактная кнопка 40 px сохраняет
            невидимую область нажатия 44 px.
          </p>
          <Button compact>Компактная</Button>
        </Card>
        <Card>
          <h3>Движение</h3>
          <p className={styles.muted}>
            При `prefers-reduced-motion: reduce` переходы и анимации отключаются глобально; спиннер
            остаётся единственным индикатором загрузки.
          </p>
        </Card>
      </div>
      <p className={styles.note}>
        В галерее показаны компоненты, но не все состояния продуктовых экранов. Полный чек-лист
        готовности компонента — в `docs/DESIGN.md` и UI Kit 1.0.
      </p>
    </Section>
  );
}

function renderSection(section: SectionId) {
  switch (section) {
    case 'foundations':
      return <Foundations />;
    case 'shells':
      return <Shells />;
    case 'buttons':
      return <Buttons />;
    case 'forms':
      return <Forms />;
    case 'statuses':
      return <Statuses />;
    case 'feedback':
      return <Feedback />;
    case 'data':
      return <DataSection />;
    case 'overlays':
      return <Overlays />;
    case 'accessibility':
      return <Accessibility />;
  }
}

export function App() {
  const [active, setActive] = useState<SectionId>('foundations');
  const [viewport, setViewport] = useState<Viewport>('auto');

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Logo />
          <span className={styles.brandSub}>UI Kit</span>
        </div>
        <span className={styles.headerMeta}>Foundation v0.1 · WCAG 2.2 AA</span>
      </header>

      <div className={styles.body}>
        <nav className={styles.nav} aria-label="Разделы UI Kit">
          {SECTIONS.map((section, index) => {
            const showGroup = index === 0 || section.group !== SECTIONS[index - 1]?.group;
            return (
              <Fragment key={section.id}>
                {showGroup && <p className={styles.navGroup}>{section.group}</p>}
                <button
                  type="button"
                  className={[styles.navLink, active === section.id ? styles.navLinkActive : '']
                    .filter(Boolean)
                    .join(' ')}
                  aria-current={active === section.id ? 'page' : undefined}
                  onClick={() => setActive(section.id)}
                >
                  {section.label}
                </button>
              </Fragment>
            );
          })}
        </nav>

        <main className={styles.main} tabIndex={-1}>
          <div className={styles.toolbar}>
            <div className={styles.viewport}>
              <span>Ширина</span>
              {(['360', '390', '768', 'auto'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={viewport === value}
                  onClick={() => setViewport(value)}
                >
                  {value === 'auto' ? 'Авто' : value}
                </button>
              ))}
            </div>
            <span className={styles.toolbarNote}>Dev-only · не входит в production-сборку</span>
          </div>

          <div
            className={styles.frame}
            style={{ maxWidth: viewport === 'auto' ? undefined : `${viewport}px` }}
          >
            {renderSection(active)}
          </div>
        </main>
      </div>
    </div>
  );
}

