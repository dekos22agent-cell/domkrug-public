import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@ui/Button';
import { EmptyState } from '@ui/EmptyState';
import { FilterBar } from '@ui/FilterBar';
import { CenteredSpinner } from '@ui/Spinner';
import { TicketCard } from '@ui/TicketCard';
import { useApartment } from '@shared/apartmentContext';
import { useTicketList } from '@shared/useTickets';
import type { TicketSummary } from '@shared/types';
import styles from './TicketsPage.module.css';
import pageStyles from '../pages.module.css';

type StatusFilter = 'all' | 'active' | 'closed' | 'rejected';

const ACTIVE_STATUSES = new Set(['new', 'accepted', 'assigned', 'in_progress', 'waiting']);

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все заявки' },
  { value: 'active', label: 'В работе' },
  { value: 'closed', label: 'Закрытые' },
  { value: 'rejected', label: 'Отклонённые' },
];

function titleOf(ticket: TicketSummary): string {
  return ticket.title ?? ticket.category.name;
}

function matchesStatus(ticket: TicketSummary, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return ACTIVE_STATUSES.has(ticket.status.code);
  if (filter === 'closed') {
    return ticket.status.code === 'closed' || ticket.status.code === 'done';
  }
  return ticket.status.code === 'rejected';
}

/**
 * Все заявки жителя.
 *
 * Карточки оставляем: на телефоне это понятнее таблицы. Поиск и статус —
 * локальные по загруженной странице (limit 50), пока у жителя не может быть
 * сотен заявок; серверный фильтр можно добавить вместе с пагинацией.
 */
export function TicketsPage() {
  const navigate = useNavigate();
  const { items, loading, error } = useTicketList('/resident/tickets?limit=50');
  const { can } = useApartment();
  const canCreate = can('tickets.create');

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((ticket) => {
      if (!matchesStatus(ticket, filter)) return false;
      if (!needle) return true;
      return [
        String(ticket.number),
        titleOf(ticket),
        ticket.category.name,
        ticket.building.addressText,
        ticket.status.name,
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [items, query, filter]);

  const reset = () => {
    setQuery('');
    setFilter('all');
  };

  return (
    <>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Мои заявки</h1>
          <p className={pageStyles.pageSubtitle}>Все обращения в управляющую компанию</p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => navigate('/my-requests/new')}>
            Новая заявка
          </Button>
        )}
      </div>

      <div className={styles.toolbar}>
        <FilterBar
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="Поиск по заявкам"
          filters={[
            {
              id: 'status',
              label: 'Статус',
              value: filter,
              options: FILTERS,
              onChange: (value) => setFilter(value as StatusFilter),
            },
          ]}
          resultCount={loading || error ? undefined : visible.length}
          onReset={reset}
        />
      </div>

      {loading ? (
        <CenteredSpinner label="Загружаем заявки" />
      ) : error ? (
        <p className={pageStyles.loadError} role="alert">
          {error}
        </p>
      ) : visible.length === 0 ? (
        <EmptyState
          title={query || filter !== 'all' ? 'Ничего не найдено' : 'Заявок пока нет'}
          description={
            query || filter !== 'all'
              ? 'Измените поиск или сбросьте фильтры.'
              : 'Здесь появятся ваши обращения и их статусы.'
          }
          action={
            query || filter !== 'all' ? (
              <Button variant="outline" onClick={reset}>
                Сбросить фильтры
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={pageStyles.list}>
          {visible.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              onOpen={() => navigate(`/my-requests/${ticket.id}`)}
            />
          ))}
        </div>
      )}
    </>
  );
}
