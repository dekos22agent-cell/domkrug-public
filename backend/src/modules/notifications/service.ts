/**
 * Внутрисистемные уведомления.
 *
 * Зачем: житель должен узнать, что УК ответила или сменила статус, а диспетчер —
 * что пришла новая заявка. Это «колокольчик» в шапке и лента.
 *
 * Таблица `notifications` появилась ещё в 006, и записи в неё уже пишутся при
 * смене статуса и назначении исполнителя. Не хватало только чтения: без него
 * уведомления копились мёртвым грузом.
 */
import { pool } from '../../db/pool.js';

export type NotificationType =
  | 'ticket_created'
  | 'ticket_status_changed'
  | 'ticket_assigned'
  | 'ticket_comment'
  | 'resident_binding_confirmed'
  | 'resident_binding_rejected'
  | 'news_published';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  /** Куда вести по клику: заявка, новость или привязка. */
  entityType: 'ticket' | 'news' | 'resident_binding' | null;
  entityId: string | null;
  /** Для заявки — её номер, чтобы показать «№12» без второго запроса. */
  entityLabel: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: NotificationItem[];
  /** Всего непрочитанных, а не в этой странице: для счётчика на колокольчике. */
  unread: number;
}

interface Row {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  entity_type: 'ticket' | 'news' | 'resident_binding' | null;
  entity_id: string | null;
  entity_label: string | null;
  read_at: Date | null;
  created_at: Date;
}

function toItem(row: Row): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Лента пользователя. Чужие уведомления не отдаются никогда: фильтр по
 * user_id — единственная защита, поэтому он в самом запросе, а не после.
 */
export async function listNotifications(
  userId: string,
  options: { limit: number; unreadOnly: boolean },
): Promise<NotificationList> {
  const [itemsRes, unreadRes] = await Promise.all([
    pool.query<Row>(
      `SELECT n.id, n.type, n.title, n.body, n.entity_type, n.entity_id,
              n.read_at, n.created_at,
              -- номер заявки подтягиваем сразу: иначе на каждый пункт ленты
              -- был бы отдельный запрос из интерфейса
              CASE WHEN n.entity_type = 'ticket' THEN t.number::text END AS entity_label
         FROM notifications n
         LEFT JOIN tickets t
                ON n.entity_type = 'ticket' AND t.id = n.entity_id
        WHERE n.user_id = $1
          AND ($2::boolean = false OR n.read_at IS NULL)
        ORDER BY n.created_at DESC
        LIMIT $3`,
      [userId, options.unreadOnly, options.limit],
    ),
    pool.query<{ unread: string }>(
      'SELECT count(*)::text AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [userId],
    ),
  ]);

  return {
    items: itemsRes.rows.map(toItem),
    unread: Number(unreadRes.rows[0]?.unread ?? 0),
  };
}

/** Отметить одно уведомление прочитанным. Чужое молча не находится. */
export async function markNotificationRead(userId: string, id: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, now())
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const res = await pool.query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
    [userId],
  );
  return res.rowCount ?? 0;
}
