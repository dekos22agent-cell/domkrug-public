import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@ui/Alert';
import { Button } from '@ui/Button';
import { Card } from '@ui/Card';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { api, ApiError } from '@shared/api';
import { formatRelative } from '@shared/format';
import type { NotificationItem } from '@shared/types';
import pageStyles from './pages.module.css';
import styles from './NotificationsPage.module.css';

function pathFor(item: NotificationItem): string | null {
  if (item.entityType === 'ticket' && item.entityId) return `/my-requests/${item.entityId}`;
  if (item.entityType === 'news') return '/news';
  if (item.entityType === 'resident_binding') return '/binding';
  return null;
}

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<{ items: NotificationItem[]; unread: number }>(
        `/notifications?limit=100${unreadOnly ? '&unreadOnly=true' : ''}`,
      );
      setItems(response.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось загрузить уведомления');
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const markAll = async () => {
    setBusy(true);
    try {
      await api.post('/notifications/read-all', {});
      setItems((prev) => prev.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    } finally {
      setBusy(false);
    }
  };

  const markRead = async (item: NotificationItem) => {
    if (!item.readAt) {
      setItems((prev) =>
        prev.map((row) => (row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row)),
      );
      try {
        await api.post(`/notifications/${item.id}/read`, {});
      } catch {
        // следующий poll вернёт актуальное состояние
      }
    }
  };

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Уведомления</h1>
          <p className={pageStyles.pageSubtitle}>Что произошло с вашими заявками и домом</p>
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            compact
            onClick={() => setUnreadOnly((value) => !value)}
          >
            {unreadOnly ? 'Все' : 'Только непрочитанные'}
          </Button>
          <Button variant="ghost" compact loading={busy} onClick={() => void markAll()}>
            Прочитать все
          </Button>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {loading ? (
        <CenteredSpinner label="Загружаем уведомления" />
      ) : items.length === 0 ? (
        <EmptyState
          title={unreadOnly ? 'Непрочитанных нет' : 'Уведомлений пока нет'}
          description="Здесь появятся ответы УК, смены статусов и объявления."
        />
      ) : (
        <div className={styles.list}>
          {items.map((item) => {
            const path = pathFor(item);
            const content = (
              <>
                <span className={styles.head}>
                  <span className={styles.title}>{item.title}</span>
                  {!item.readAt && <span className={styles.dot} aria-label="Не прочитано" />}
                </span>
                {item.body && <span className={styles.body}>{item.body}</span>}
                <span className={styles.time}>{formatRelative(item.createdAt)}</span>
              </>
            );
            return (
              <Card key={item.id} className={[styles.item, item.readAt ? '' : styles.unread].join(' ')}>
                {path ? (
                  <Link className={styles.link} to={path} onClick={() => void markRead(item)}>
                    {content}
                  </Link>
                ) : (
                  <button type="button" className={styles.link} onClick={() => void markRead(item)}>
                    {content}
                  </button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
