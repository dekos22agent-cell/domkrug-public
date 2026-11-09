import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { DataTable, type DataTableColumn } from '@ui/DataTable';
import { EmptyState } from '@ui/EmptyState';
import { FilterBar } from '@ui/FilterBar';
import { StatusBadge } from '@ui/StatusBadge';
import { CenteredSpinner } from '@ui/Spinner';
import { useAuth } from '@shared/authContext';
import { formatRelative } from '@shared/format';
import { useTicketList } from '@shared/useTickets';
import type { TicketSummary } from '@shared/types';
import pageStyles from './pages.module.css';
import styles from './InboxPage.module.css';

type Filter = 'all' | 'new' | 'in_work' | 'overdue' | 'emergency';
type Sort = { key: string; direction: 'asc' | 'desc' } | null;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Все заявки' },
  { value: 'new', label: 'Новые' },
  { value: 'in_work', label: 'В работе' },
  { value: 'overdue', label: 'Просроченные' },
  { value: 'emergency', label: 'Аварийные' },
];

function titleOf(ticket: TicketSummary): string {
  return ticket.title ?? ticket.category.name;
}

function addressOf(ticket: TicketSummary): string {
  const apartment = ticket.apartment ? `, кв. ${ticket.apartment.number}` : '';
  return `${ticket.building.addressText}${apartment}`;
}

/**
 * Инбокс диспетчера.
 *
 * Статусные фильтры остаются серверными: заявок станет больше 50, и
 * клиентская фильтрация перестанет работать по пагинации. Поиск — по уже
 * загруженной странице (limit 50), чтобы не менять контракт API.
 */
export function InboxPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>(null);

  const path = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' });
    if (filter === 'new') params.set('status', 'new');
    if (filter === 'in_work') params.set('status', 'accepted,assigned,in_progress,waiting');
    if (filter === 'overdue') params.set('onlyOverdue', 'true');
    if (filter === 'emergency') params.set('onlyEmergency', 'true');
    return `/tickets?${params.toString()}`;
  }, [filter]);

  const { items, loading, error } = useTicketList(path);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? items.filter((ticket) =>
          [
            String(ticket.number),
            titleOf(ticket),
            addressOf(ticket),
            ticket.assignedTo?.fullName ?? '',
            ticket.status.name,
          ]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : [...items];

    if (!sort) return filtered;

    const direction = sort.direction === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort.key === 'number') return (a.number - b.number) * direction;
      if (sort.key === 'createdAt') {
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * direction;
      }
      if (sort.key === 'status') return a.status.name.localeCompare(b.status.name, 'ru') * direction;
      return titleOf(a).localeCompare(titleOf(b), 'ru') * direction;
    });
  }, [items, query, sort]);

  const columns: DataTableColumn<TicketSummary>[] = [
    {
      key: 'number',
      header: '№',
      width: '72px',
      sortable: true,
      render: (ticket) => (
        <span className={styles.number}>№{ticket.number}</span>
      ),
    },
    {
      key: 'title',
      header: 'Обращение',
      sortable: true,
      render: (ticket) => (
        <span className={styles.ticketTitle}>
          <Link to={`/tickets/${ticket.id}`} className={styles.titleLink}>
            {titleOf(ticket)}
          </Link>
          <span className={styles.address}>{addressOf(ticket)}</span>
        </span>
      ),
    },
    {
      key: 'assignee',
      header: 'Исполнитель',
      hideOnMobile: true,
      render: (ticket) => ticket.assignedTo?.fullName ?? 'Не назначен',
    },
    {
      key: 'status',
      header: 'Статус',
      sortable: true,
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
      sortable: true,
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
          <h1 className={pageStyles.pageTitle}>Инбокс</h1>
          <p className={pageStyles.pageSubtitle}>Заявки жителей вашей УК</p>
        </div>

        {hasPermission('ticket.create') && (
          <div className={pageStyles.actions}>
            <Button compact onClick={() => navigate('/tickets/new')}>
              Новое обращение
            </Button>
          </div>
        )}
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
        <CenteredSpinner label="Загружаем заявки" />
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
          ariaLabel="Заявки жителей"
          onRowClick={(ticket) => navigate(`/tickets/${ticket.id}`)}
          getRowAriaLabel={(ticket) => `Открыть заявку №${ticket.number}`}
          sort={sort}
          onSort={(key) =>
            setSort((current) =>
              current?.key === key
                ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
                : { key, direction: 'asc' },
            )
          }
          empty={
            <EmptyState
              title={query || filter !== 'all' ? 'Ничего не найдено' : 'Заявок пока нет'}
              description={
                query || filter !== 'all'
                  ? 'Измените поиск или сбросьте фильтры.'
                  : 'Здесь появятся обращения жителей.'
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
