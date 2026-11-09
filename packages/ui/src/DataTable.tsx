import type { ReactNode } from 'react';
import styles from './DataTable.module.css';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  hideOnMobile?: boolean;
  width?: string;
}

type SortDirection = 'asc' | 'desc';

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  density?: 'compact' | 'default' | 'comfortable';
  ariaLabel?: string;
  empty?: ReactNode;
  sort?: { key: string; direction: SortDirection } | null;
  onSort?: (key: string) => void;
  selectedKeys?: string[];
  onToggleRow?: (key: string) => void;
  onToggleAll?: () => void;
  /** Клик по всей строке; интерактивные элементы внутри строки не перехватываются. */
  onRowClick?: (row: T) => void;
  getRowAriaLabel?: (row: T) => string;
}

/**
 * Таблица данных.
 *
 * Без fetch и без собственной сортировки: данные и состояние приходят снаружи.
 * Сортировка — кнопки в th с aria-sort; на мобильном строки превращаются в
 * карточки с подписями из data-label.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  density = 'default',
  ariaLabel,
  empty,
  sort,
  onSort,
  selectedKeys,
  onToggleRow,
  onToggleAll,
  onRowClick,
  getRowAriaLabel,
}: DataTableProps<T>) {
  const selectable = Boolean(onToggleRow);
  const rowClickable = Boolean(onRowClick);
  const allSelected =
    selectable && rows.length > 0 && selectedKeys?.length === rows.length;

  if (rows.length === 0 && empty) {
    return <div className={styles.empty}>{empty}</div>;
  }

  return (
    <div className={styles.wrapper}>
      <table
        className={[styles.table, styles[density]].filter(Boolean).join(' ')}
        aria-label={ariaLabel}
      >
        <thead>
          <tr>
            {selectable && (
              <th className={styles.checkCell} scope="col">
                {onToggleAll && (
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onToggleAll}
                    aria-label="Выбрать все строки"
                  />
                )}
              </th>
            )}
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={column.hideOnMobile ? styles.hideOnMobile : undefined}
                  style={column.width ? { width: column.width } : undefined}
                  aria-sort={
                    active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  {column.sortable && onSort ? (
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => onSort(column.key)}
                    >
                      {column.header}
                      <span aria-hidden="true">{active ? (sort?.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = getRowKey(row);
            const selected = selectedKeys?.includes(key) ?? false;
            return (
              <tr
                key={key}
                className={[selected ? styles.selected : '', rowClickable ? styles.clickable : '']
                  .filter(Boolean)
                  .join(' ')}
                tabIndex={rowClickable ? 0 : undefined}
                aria-label={getRowAriaLabel?.(row)}
                onClick={
                  onRowClick
                    ? (event) => {
                        const target = event.target as HTMLElement;
                        if (target.closest('a, button, input, select, textarea, label')) return;
                        onRowClick(row);
                      }
                    : undefined
                }
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >                {selectable && (
                  <td className={styles.checkCell} data-label="Выбор">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleRow?.(key)}
                      aria-label={`Выбрать строку ${key}`}
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td
                    key={column.key}
                    data-label={typeof column.header === 'string' ? column.header : undefined}
                    className={column.hideOnMobile ? styles.hideOnMobile : undefined}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
