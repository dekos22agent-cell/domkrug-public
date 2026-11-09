/**
 * Сигнал «что изменилось с прошлого раза».
 *
 * Зачем отдельный эндпоинт. Интерфейсу нужно знать, что появилась новая заявка
 * или пришло уведомление, не перезагружая страницу. Тянуть ради этого полные
 * списки каждые несколько секунд — лишний трафик и лишняя нагрузка на базу.
 *
 * Здесь отдаётся только «отпечаток» состояния: сколько заявок и когда последняя
 * менялась, есть ли непрочитанные уведомления, когда последнее событие доступа.
 * Клиент сравнивает отпечаток с предыдущим и перезапрашивает лишь те списки,
 * которые действительно изменились.
 *
 * Почему опрос, а не WebSocket/SSE. Токен доступа живёт в памяти вкладки,
 * а EventSource не умеет отправлять заголовок Authorization — пришлось бы
 * переделывать авторизацию ради одного канала. На пилоте с несколькими
 * пользователями опрос раз в несколько секунд дешевле и надёжнее: нет
 * долгоживущих соединений, нечему рваться при перезапуске службы.
 */
import { pool } from '../../db/pool.js';
import type { AuthContext } from '../../plugins/auth.js';

export interface UpdatesSnapshot {
  /** Время сервера: клиенту полезно, если часы на машине врут. */
  serverTime: string;
  /**
   * Заявки, видимые этому пользователю. Сравнивать нужно оба поля:
   * count ловит создание, maxUpdatedAt — правку существующих.
   */
  tickets: { count: number; maxUpdatedAt: string | null };
  /** Последнее событие доступа самого пользователя. */
  access: { lastEventAt: string | null };
  /** Уведомления: непрочитанные и время последнего. */
  notifications: { unread: number; lastAt: string | null };
}

/**
 * Условие видимости заявок — то же, что в списках: УК видит всё, исполнитель —
 * назначенное ему, житель — созданное им. Дублирование правила намеренное:
 * `/updates` не должен показывать существование чужих заявок даже числом.
 */
function ticketScope(auth: AuthContext): { where: string; params: unknown[] } {
  if (auth.permissions.has('ticket.view.all') && auth.tenantId) {
    return { where: 't.tenant_id = $1', params: [auth.tenantId] };
  }
  if (auth.permissions.has('ticket.view.assigned')) {
    return { where: 't.assigned_to = $1', params: [auth.userId] };
  }
  return { where: 't.created_by = $1', params: [auth.userId] };
}

export async function getUpdates(auth: AuthContext): Promise<UpdatesSnapshot> {
  // У каждого запроса своя нумерация параметров: $1 в одном запросе никак не
  // связан с $1 в другом. Поэтому ниже везде $1 — это user_id.
  const scope = ticketScope(auth);

  const [ticketsRes, accessRes, notifRes] = await Promise.all([
    pool.query<{ count: string; max_updated: Date | null }>(
      `SELECT count(*)::text AS count, max(t.updated_at) AS max_updated
         FROM tickets t
        WHERE ${scope.where}`,
      scope.params,
    ),
    pool.query<{ last_at: Date | null }>(
      'SELECT max(created_at) AS last_at FROM access_events WHERE user_id = $1',
      [auth.userId],
    ),
    pool.query<{ unread: string; last_at: Date | null }>(
      `SELECT count(*) FILTER (WHERE read_at IS NULL)::text AS unread,
              max(created_at) AS last_at
         FROM notifications
        WHERE user_id = $1`,
      [auth.userId],
    ),
  ]);

  const tickets = ticketsRes.rows[0];
  const access = accessRes.rows[0];
  const notif = notifRes.rows[0];

  return {
    serverTime: new Date().toISOString(),
    tickets: {
      count: Number(tickets?.count ?? 0),
      maxUpdatedAt: tickets?.max_updated ? tickets.max_updated.toISOString() : null,
    },
    access: { lastEventAt: access?.last_at ? access.last_at.toISOString() : null },
    notifications: {
      unread: Number(notif?.unread ?? 0),
      lastAt: notif?.last_at ? notif.last_at.toISOString() : null,
    },
  };
}
