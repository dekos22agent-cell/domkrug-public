import { useMemo, useState } from 'react';
import { Alert } from '@ui/Alert';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import { DataTable, type DataTableColumn } from '@ui/DataTable';
import { Drawer } from '@ui/Drawer';
import { EmptyState } from '@ui/EmptyState';
import { FilterBar } from '@ui/FilterBar';
import { CenteredSpinner } from '@ui/Spinner';
import { TextArea } from '@ui/TextArea';
import { api, ApiError } from '@shared/api';
import { useAuth } from '@shared/authContext';
import { useTenantBindings } from '@shared/useBindings';
import { formatDateTime, formatPhone } from '@shared/format';
import type { TenantBindingItem } from '@shared/types';
import styles from './BindingsPage.module.css';
import pageStyles from './pages.module.css';

type StatusFilter = 'pending' | 'confirmed' | 'rejected' | 'all';
type Sort = { key: string; direction: 'asc' | 'desc' } | null;

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: 'Ожидают' },
  { value: 'confirmed', label: 'Подтверждены' },
  { value: 'rejected', label: 'Отклонены' },
  { value: 'all', label: 'Все' },
];

const ROLE_LABELS: Record<string, string> = {
  owner: 'собственник',
  renter: 'арендатор',
  representative: 'представитель',
};

const STATUS: Record<
  TenantBindingItem['status'],
  { label: string; variant: 'warning' | 'success' | 'danger' }
> = {
  pending: { label: 'Ожидает', variant: 'warning' },
  confirmed: { label: 'Подтверждена', variant: 'success' },
  rejected: { label: 'Отклонена', variant: 'danger' },
};

/**
 * Очередь заявок на привязку — экран сотрудника УК.
 *
 * Подтверждать может и диспетчер (RBAC.md п. 4.3): на пилоте он единственный,
 * кто постоянно на связи, и заставлять жителя ждать администратора — прямой
 * путь к «я не смог зарегистрироваться».
 *
 * Статусные фильтры — серверные; поиск и сортировка — по загруженной
 * странице (limit 50). Отклонение вынесено в Drawer, чтобы не раздувать
 * строку таблицы формой.
 */
export function BindingsPage() {
  const { hasPermission } = useAuth();
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>(null);
  const { items, loading, error, reload } = useTenantBindings(filter);

  const [rejectTarget, setRejectTarget] = useState<TenantBindingItem | null>(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canConfirm = hasPermission('resident_binding.confirm');
  const canReject = hasPermission('resident_binding.reject');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? items.filter((item) =>
          [
            item.residentName,
            item.residentPhone ?? '',
            item.addressText,
            item.apartmentNumber,
            ROLE_LABELS[item.roleInApartment] ?? item.roleInApartment,
          ]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : [...items];

    if (!sort) return filtered;

    const direction = sort.direction === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort.key === 'requestedAt') {
        return (
          (new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime()) * direction
        );
      }
      if (sort.key === 'status') return a.status.localeCompare(b.status) * direction;
      if (sort.key === 'address') {
        return `${a.addressText} ${a.apartmentNumber}`.localeCompare(
          `${b.addressText} ${b.apartmentNumber}`,
          'ru',
        ) * direction;
      }
      return a.residentName.localeCompare(b.residentName, 'ru') * direction;
    });
  }, [items, query, sort]);

  const runAction = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    setActionError(null);
    try {
      await action();
      setRejectTarget(null);
      setReason('');
      reload();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'Не удалось выполнить действие. Попробуйте ещё раз.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const confirm = (item: TenantBindingItem) =>
    runAction(item.id, () => api.post(`/resident-bindings/${item.id}/confirm`, {}));

  const reject = () => {
    if (!rejectTarget) return;
    const target = rejectTarget;
    void runAction(target.id, () =>
      api.post(`/resident-bindings/${target.id}/reject`, { reason: reason.trim() }),
    );
  };

  const columns: DataTableColumn<TenantBindingItem>[] = [
    {
      key: 'resident',
      header: 'Житель',
      sortable: true,
      render: (item) => (
        <span className={styles.person}>
          <strong>{item.residentName}</strong>
          {item.residentPhone && <span className={styles.muted}>{formatPhone(item.residentPhone)}</span>}
        </span>
      ),
    },
    {
      key: 'address',
      header: 'Адрес',
      sortable: true,
      render: (item) => (
        <span className={styles.person}>
          <span>{item.addressText}</span>
          <span className={styles.muted}>кв. {item.apartmentNumber}</span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Роль',
      hideOnMobile: true,
      render: (item) => ROLE_LABELS[item.roleInApartment] ?? item.roleInApartment,
    },
    {
      key: 'requestedAt',
      header: 'Заявка',
      sortable: true,
      hideOnMobile: true,
      render: (item) => formatDateTime(item.requestedAt),
    },
    {
      key: 'status',
      header: 'Статус',
      sortable: true,
      render: (item) => (
        <span className={styles.statusCell}>
          <Badge variant={STATUS[item.status].variant}>{STATUS[item.status].label}</Badge>
          {item.status === 'rejected' && item.rejectReason && (
            <span className={styles.reason}>Причина: {item.rejectReason}</span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Действия',
      render: (item) => {
        if (item.status !== 'pending') return null;
        return (
          <span className={styles.actions}>
            {canConfirm && (
              <Button
                compact
                loading={busyId === item.id}
                onClick={() => void confirm(item)}
              >
                Подтвердить
              </Button>
            )}
            {canReject && (
              <Button
                compact
                variant="secondary"
                disabled={busyId === item.id}
                onClick={() => {
                  setRejectTarget(item);
                  setReason('');
                  setActionError(null);
                }}
              >
                Отклонить
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Привязки жителей</h1>
          <p className={pageStyles.pageSubtitle}>
            Заявки на привязку к квартирам — их нужно подтвердить или отклонить
          </p>
        </div>
      </div>

      <div className={styles.toolbar}>
        <FilterBar
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="Поиск по жителю, телефону или адресу"
          filters={[
            {
              id: 'status',
              label: 'Статус',
              value: filter,
              options: FILTERS,
              onChange: (value) => setFilter(value as StatusFilter),
            },
          ]}
          resultCount={loading || error ? undefined : rows.length}
          onReset={() => {
            setQuery('');
            setFilter('pending');
          }}
        />
      </div>

      {actionError && (
        <Alert variant="danger" className={styles.alert}>
          {actionError}
        </Alert>
      )}

      {loading ? (
        <CenteredSpinner label="Загружаем заявки" />
      ) : error ? (
        <Alert variant="danger" title="Не удалось загрузить привязки">
          {error}
        </Alert>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(item) => item.id}
          density="default"
          ariaLabel="Заявки на привязку"
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
              title={
                query || filter !== 'pending'
                  ? 'Ничего не найдено'
                  : 'Нет заявок, ожидающих подтверждения'
              }
              description={
                query || filter !== 'pending'
                  ? 'Измените поиск или сбросьте фильтры.'
                  : 'Житель увидит адрес и сможет создавать заявки только после подтверждения.'
              }
              action={
                query || filter !== 'pending' ? (
                  <Button
                    compact
                    variant="outline"
                    onClick={() => {
                      setQuery('');
                      setFilter('pending');
                    }}
                  >
                    Сбросить фильтры
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      {rejectTarget && (
        <Drawer
          title={`Отклонить заявку — ${rejectTarget.residentName}`}
          onClose={() => {
            if (busyId) return;
            setRejectTarget(null);
            setReason('');
          }}
        >
          <div className={styles.drawerBody}>
            <span className={styles.muted}>
              {rejectTarget.addressText}, кв. {rejectTarget.apartmentNumber}
            </span>
            {actionError && <Alert variant="danger">{actionError}</Alert>}
            <TextArea
              label="Причина отклонения"
              placeholder="Например: такой квартиры нет в этом доме"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              hint="Житель увидит причину"
            />
            <div className={styles.drawerActions}>
              <Button
                variant="danger"
                loading={busyId === rejectTarget.id}
                disabled={reason.trim().length < 3 || busyId !== null}
                onClick={reject}
              >
                Отклонить заявку
              </Button>
              <Button
                variant="ghost"
                disabled={busyId !== null}
                onClick={() => {
                  setRejectTarget(null);
                  setReason('');
                }}
              >
                Отмена
              </Button>
            </div>
          </div>
        </Drawer>
      )}
    </>
  );
}
