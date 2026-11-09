import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@ui/Button';
import { DataTable, type DataTableColumn } from '@ui/DataTable';
import { EmptyState } from '@ui/EmptyState';
import { FilterBar } from '@ui/FilterBar';
import { CenteredSpinner } from '@ui/Spinner';
import { useBuildings } from '@shared/useStructure';
import { complexLabel, objectKindLabel } from '@shared/objectKind';
import type { BuildingListItem } from '@shared/types';
import pageStyles from './pages.module.css';
import styles from './ObjectsPage.module.css';

/** Реестр объектов управления: дома, посёлки и нежилые здания. */
export function ObjectsPage() {
  const navigate = useNavigate();
  const buildings = useBuildings();
  const [search, setSearch] = useState('');

  const filtered = buildings.items.filter((building) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return (
      building.addressText.toLowerCase().includes(needle) ||
      (building.complexName ?? '').toLowerCase().includes(needle) ||
      objectKindLabel(building.objectKind).toLowerCase().includes(needle)
    );
  });

  const columns: DataTableColumn<BuildingListItem>[] = [
    {
      key: 'object',
      header: 'Объект',
      render: (building) => (
        <span className={styles.object}>
          <strong>{building.addressText}</strong>
          <span className={styles.sub}>
            {building.complexName ? complexLabel(building.complexName) : 'Отдельный объект'}
          </span>
        </span>
      ),
    },
    {
      key: 'kind',
      header: 'Тип',
      width: '170px',
      render: (building) => (
        <span className={styles.kind}>{objectKindLabel(building.objectKind)}</span>
      ),
    },
    {
      key: 'units',
      header: 'Помещений',
      width: '120px',
      hideOnMobile: true,
      render: (building) => building.apartmentsCount,
    },
    {
      key: 'tickets',
      header: 'Открытых заявок',
      width: '150px',
      hideOnMobile: true,
      render: (building) => building.openTickets,
    },
    {
      key: 'action',
      header: '',
      width: '130px',
      render: (building) => (
        <Link className={styles.passportLink} to={`/objects/${building.id}`}>
          Паспорт →
        </Link>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Объекты</h1>
          <p className={pageStyles.pageSubtitle}>
            Дома и территории в управлении. Начните с паспорта — из него видно
            состав, людей и текущую эксплуатацию.
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate('/apartments')}>
          Квартиры и панель
        </Button>
      </div>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Адрес, ЖК или тип объекта"
        resultCount={buildings.loading || buildings.error ? undefined : filtered.length}
        onReset={() => setSearch('')}
      />

      {buildings.loading ? (
        <CenteredSpinner label="Загружаем объекты" />
      ) : buildings.error ? (
        <p className={pageStyles.loadError}>{buildings.error}</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={buildings.items.length === 0 ? 'Объектов пока нет' : 'Ничего не нашлось'}
          description={
            buildings.items.length === 0
              ? 'Добавление объектов появится вместе с импортом домов.'
              : 'Попробуйте изменить запрос или сбросить поиск.'
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          getRowKey={(building) => building.id}
          density="compact"
          ariaLabel="Объекты управления"
          onRowClick={(building) => navigate(`/objects/${building.id}`)}
          getRowAriaLabel={(building) => `Открыть паспорт: ${building.addressText}`}
        />
      )}
    </div>
  );
}
