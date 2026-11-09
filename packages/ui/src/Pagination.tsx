import styles from './Pagination.module.css';

interface PaginationProps {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  label?: string;
}

function pageItems(page: number, count: number): (number | 'ellipsis')[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);

  const items: (number | 'ellipsis')[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(count - 1, page + 1);

  if (start > 2) items.push('ellipsis');
  for (let value = start; value <= end; value += 1) items.push(value);
  if (end < count - 1) items.push('ellipsis');
  items.push(count);
  return items;
}

export function Pagination({ page, pageCount, onChange, label = 'Страницы' }: PaginationProps) {
  if (pageCount <= 1) return null;

  return (
    <nav className={styles.root} aria-label={label}>
      <button
        type="button"
        className={styles.step}
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        aria-label="Предыдущая страница"
      >
        ←
      </button>

      {pageItems(page, pageCount).map((item, index) =>
        item === 'ellipsis' ? (
          <span key={`ellipsis-${index}`} className={styles.ellipsis} aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className={[styles.page, item === page ? styles.active : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(item)}
            aria-current={item === page ? 'page' : undefined}
            aria-label={`Страница ${item}`}
          >
            {item}
          </button>
        ),
      )}

      <button
        type="button"
        className={styles.step}
        onClick={() => onChange(Math.min(pageCount, page + 1))}
        disabled={page >= pageCount}
        aria-label="Следующая страница"
      >
        →
      </button>
    </nav>
  );
}
