import { useId } from 'react';
import styles from './FilterBar.module.css';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: FilterConfig[];
  onReset?: () => void;
  resultCount?: number;
}

/**
 * Панель фильтров для таблиц и списков.
 *
 * Поиск и селекты — обычные form-контролы с label; сброс не прячет
 * выбранные значения, а возвращает весь набор. На мобильном поля
 * складываются в колонку без горизонтального скролла.
 */
export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Поиск',
  filters = [],
  onReset,
  resultCount,
}: FilterBarProps) {
  const searchId = useId();

  return (
    <div className={styles.root} role="search" aria-label="Фильтры">
      <div className={styles.search}>
        <label className={styles.srOnly} htmlFor={searchId}>
          Поиск
        </label>
        <input
          id={searchId}
          type="search"
          className={styles.input}
          value={search}
          placeholder={searchPlaceholder}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        {search && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => onSearchChange('')}
            aria-label="Очистить поиск"
          >
            ×
          </button>
        )}
      </div>

      {filters.map((filter) => (
        <label key={filter.id} className={styles.filter}>
          <span className={styles.label}>{filter.label}</span>
          <select
            className={styles.select}
            value={filter.value}
            onChange={(event) => filter.onChange(event.target.value)}
          >
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      <div className={styles.tail}>
        {typeof resultCount === 'number' && (
          <span className={styles.count} aria-live="polite">
            Найдено: {resultCount}
          </span>
        )}
        {onReset && (
          <button type="button" className={styles.reset} onClick={onReset}>
            Сбросить
          </button>
        )}
      </div>
    </div>
  );
}
