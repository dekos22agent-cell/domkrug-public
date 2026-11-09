import { Badge } from '@ui/Badge';
import { Card } from '@ui/Card';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { formatDateTime } from '@shared/format';
import { useAuditEntries } from '@shared/useUtilities';
import type { AuditEntry } from '@shared/types';
import pageStyles from './pages.module.css';
import styles from './AuditPage.module.css';

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Вход',
  'auth.logout': 'Выход',
  'auth.failed': 'Неудачный вход',
  'auth.password_change': 'Смена пароля',
  'ticket.create': 'Создана заявка',
  'ticket.status_change': 'Смена статуса заявки',
  'ticket.assign': 'Назначен исполнитель',
  'ticket.delete': 'Удалена заявка',
  'resident.confirm': 'Подтверждена привязка',
  'resident.reject': 'Отклонена привязка',
  'building.passport_update': 'Изменён паспорт',
  'apartment.create': 'Добавлено помещение',
  'apartment.update': 'Изменено помещение',
  'staff.create': 'Добавлен сотрудник',
  'staff.update': 'Изменён сотрудник',
  'news.create': 'Создано объявление',
  'news.publish': 'Опубликовано объявление',
  'document.create': 'Добавлен документ',
  'document.publish': 'Опубликован документ',
  'contact.create': 'Добавлен телефон',
  'contact.update': 'Изменён телефон',
  'contact.delete': 'Удалён телефон',
  'meter.reading_submit': 'Передано показание',
  'emergency.call': 'Аварийный вызов',
  'access.open': 'Открыта дверь',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function entityLabel(item: AuditEntry): string {
  if (item.entityType === 'ticket') return 'заявка';
  if (item.entityType === 'staff') return 'сотрудник';
  if (item.entityType === 'building') return 'объект';
  if (item.entityType === 'news') return 'объявление';
  if (item.entityType === 'document') return 'документ';
  if (item.entityType === 'contact') return 'телефон';
  return item.entityType ?? '';
}

export function AuditPage() {
  const audit = useAuditEntries();

  return (
    <div className={styles.page}>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Журнал действий</h1>
          <p className={pageStyles.pageSubtitle}>
            Кто и что изменил в управляющей компании · последние 100 событий
          </p>
        </div>
      </div>

      {audit.loading ? (
        <CenteredSpinner label="Загружаем журнал" />
      ) : audit.error ? (
        <p className={pageStyles.loadError}>{audit.error}</p>
      ) : audit.items.length === 0 ? (
        <EmptyState title="Записей пока нет" description="Действия сотрудников появятся здесь." />
      ) : (
        <div className={styles.list}>
          {audit.items.map((item) => (
            <Card key={item.id} className={styles.row}>
              <div className={styles.main}>
                <span className={styles.action}>{actionLabel(item.action)}</span>
                <span className={styles.meta}>
                  {item.actorName ?? 'Система'}
                  {item.entityType ? ` · ${entityLabel(item)}` : ''}
                  {item.entityId ? ` · ${item.entityId.slice(0, 8)}` : ''}
                </span>
              </div>
              <div className={styles.side}>
                <Badge variant="neutral">{item.action}</Badge>
                <span className={styles.date}>{formatDateTime(item.createdAt)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
