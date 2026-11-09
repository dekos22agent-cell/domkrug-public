import { Badge } from '@ui/Badge';
import { Card } from '@ui/Card';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { formatDateTime } from '@shared/format';
import { useAnnouncements } from '@shared/useUtilities';
import pageStyles from './pages.module.css';
import styles from './NewsPage.module.css';

/** Лента объявлений УК. */
export function NewsPage() {
  const { items, loading, error } = useAnnouncements();

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Объявления</h1>
          <p className={pageStyles.pageSubtitle}>Новости и сообщения управляющей компании</p>
        </div>
      </div>

      {loading ? (
        <CenteredSpinner label="Загружаем объявления" />
      ) : error ? (
        <p className={pageStyles.loadError}>{error}</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="Объявлений пока нет"
          description="Здесь появятся сообщения управляющей компании: работы, отключения, собрания."
        />
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <Card
              key={item.id}
              className={[styles.card, item.isEmergency ? styles.emergency : '']
                .filter(Boolean)
                .join(' ')}
            >
              <div className={styles.head}>
                <h2 className={styles.title}>{item.title}</h2>
                {item.isEmergency && <Badge variant="danger">Важно</Badge>}
              </div>
              <p className={styles.body}>{item.body}</p>
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
