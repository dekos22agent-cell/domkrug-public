import { Badge } from '@ui/Badge';
import { Card } from '@ui/Card';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { formatDateTime } from '@shared/format';
import { useDocuments } from '@shared/useUtilities';
import type { DocumentCategory } from '@shared/types';
import pageStyles from './pages.module.css';
import styles from './DocumentsPage.module.css';

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  house: 'Дом',
  apartment: 'Квартира',
  receipt: 'Квитанция',
  other: 'Документ',
};

export function DocumentsPage() {
  const { items, loading, error } = useDocuments();

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Документы</h1>
          <p className={pageStyles.pageSubtitle}>Документы дома и управляющей компании</p>
        </div>
      </div>

      {loading ? (
        <CenteredSpinner label="Загружаем документы" />
      ) : error ? (
        <p className={pageStyles.loadError}>{error}</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="Документов пока нет"
          description="Управляющая компания добавит сюда документы дома и квитанции."
        />
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <Card key={item.id} className={styles.card}>
              <div className={styles.head}>
                <div>
                  <h2 className={styles.title}>{item.title}</h2>
                  <div className={styles.meta}>
                    <Badge variant="neutral">{CATEGORY_LABELS[item.category]}</Badge>
                    {item.buildingAddress && <span>{item.buildingAddress}</span>}
                  </div>
                </div>
                <a
                  className={styles.open}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Открыть
                </a>
              </div>
              {item.description && <p className={styles.description}>{item.description}</p>}
              {item.publishedAt && (
                <span className={styles.date}>{formatDateTime(item.publishedAt)}</span>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
