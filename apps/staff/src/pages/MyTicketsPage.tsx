import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { DataTable, type DataTableColumn } from '@ui/DataTable';
import { EmptyState } from '@ui/EmptyState';
import { FilterBar } from '@ui/FilterBar';
import { CenteredSpinner } from '@ui/Spinner';
import { StatusBadge } from '@ui/StatusBadge';
import { formatRelative } from '@shared/format';
import { useTicketList } from '@shared/useTickets';
import type { TicketSummary } from '@shared/types';
import styles from './MyTicketsPage.module.css';
import pageStyles from './pages.module.css';

type Filter = 'all' | 'active' | 'closed' | 'overdue' | 'emergency';

const ACTIVE = new Set(['new', 'accepted', 'assigned', 'in_progress', 'waiting']);

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Все задания' },
  { value: 'active', label: 'В работе' },
  { value: 'closed', label: 'Закрытые' },
  { value: 'overdue', label: 'Просроченные' },
  { value: 'emergency', label: 'Аварийные' },
];

function titleOf(ticket: TicketSummary): string {
  return ticket.title ?? ticket.category.name;
}

function matchesFilter(ticket: TicketSummary, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return ACTIVE.has(ticket.status.code);
  if (filter === 'closed') return ticket.status.code === 'closed' || ticket.status.code === 'done';
  if (filter === 'overdue') return ticket.isOverdue;
  return ticket.priority === 'emergency';
}

/**
 * Кабинет исполнителя: только назначенные мне заявки.
 *
 * Эндпоинт `/tickets/assigned` требует права `ticket.view.assigned` и сам
 * ограничивает выборку текущим пользователем — фильтровать на клиенте нельзя,
 * иначе чужие заявки попадут в ответ. Поиск и статус — по загруженной
 * странице (limit 50).
 */
export function MyTicketsPage() {
  const navigate = useNavigate();
  const { items, loading, error } = useTicketList('/tickets/assigned?limit=50');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((ticket) => {
      if (!matchesFilter(ticket, filter)) return false;
      if (!needle) return true;
      return [
        String(ticket.number),
        titleOf(ticket),
        ticket.building.addressText,
        ticket.status.name,
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [items, query, filter]);

  const columns: DataTableColumn<TicketSummary>[] = [
    {
      key: 'number',
      header: '№',
      width: '72px',
      render: (ticket) => <span className={styles.number}>№{ticket.number}</span>,
    },
    {
      key: 'title',
      header: 'Обращение',
      render: (ticket) => (
        <span className={styles.titleCell}>
          <Link to={`/tickets/${ticket.id}`} className={styles.titleLink}>
            {titleOf(ticket)}
          </Link>
          <span className={styles.address}>
            {ticket.building.addressText}
            {ticket.apartment ? `, кв. ${ticket.apartment.number}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      render: (ticket) => (
        <span className={styles.statusCell}>
          <StatusBadge code={ticket.status.code} />
          {ticket.isOverdue && <Badge variant="warning">Просрочена</Badge>}
          {ticket.priority === 'emergency' && <Badge variant="danger">Аварийная</Badge>}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Создана',
      hideOnMobile: true,
      render: (ticket) => formatRelative(ticket.createdAt),
    },
  ];

  const reset = () => {
    setQuery('');
    setFilter('all');
  };

  return (
    <>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Мои задания</h1>
          <p className={pageStyles.pageSubtitle}>Заявки, назначенные на вас</p>
        </div>
      </div>

      <div className={styles.toolbar}>
        <FilterBar
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="Поиск по номеру, теме или адресу"
          filters={[
            {
              id: 'status',
              label: 'Статус',
              value: filter,
              options: FILTERS,
              onChange: (value) => setFilter(value as Filter),
            },
          ]}
          resultCount={loading || error ? undefined : rows.length}
          onReset={reset}
        />
      </div>

      {loading ? (
        <CenteredSpinner label="Загружаем задания" />
      ) : error ? (
        <p className={pageStyles.loadError} role="alert">
          {error}
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(ticket) => ticket.id}
          density="compact"
          ariaLabel="Задания исполнителя"
          onRowClick={(ticket) => navigate(`/tickets/${ticket.id}`)}
          getRowAriaLabel={(ticket) => `Открыть заявку №${ticket.number}`}
          empty={
            <EmptyState
              title={query || filter !== 'all' ? 'Ничего не найдено' : 'Заданий пока нет'}
              description={
                query || filter !== 'all'
                  ? 'Измените поиск или сбросьте фильтры.'
                  : 'Когда диспетчер назначит вам заявку, она появится здесь.'
              }
              action={
                query || filter !== 'all' ? (
                  <Button compact variant="outline" onClick={reset}>
                    Сбросить фильтры
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
    </>
  );
}
