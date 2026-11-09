/**
 * Провайдер живых обновлений.
 *
 * Один опрос на всё приложение: раз в несколько секунд спрашиваем у сервера
 * «отпечаток» состояния (сколько заявок, когда менялись, есть ли уведомления).
 * Если отпечаток изменился — увеличиваем счётчик, и страницы, которые на него
 * подписаны, сами перезапрашивают свои данные.
 *
 * Что важно в реализации:
 *  - опрос молчит, когда вкладка скрыта: телефон в кармане не должен тянуть
 *    запросы и садить батарею;
 *  - при возврате на вкладку опрос срабатывает сразу, не ожидая интервала;
 *  - ошибки сети не показываются: это фоновая проверка, а не действие человека.
 *    Следующая попытка всё исправит.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import { useAuth } from './authContext';
import type { NotificationItem, UpdatesSnapshot } from './types';
import { UpdatesContext } from './updatesContext';

/** Интервал опроса. 5 секунд — компромисс между отзывчивостью и нагрузкой. */
const POLL_MS = 5000;

export function UpdatesProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  const [ticketsTick, setTicketsTick] = useState(0);
  const [accessTick, setAccessTick] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  /** Предыдущий отпечаток: с ним сравниваем. Ref, а не состояние — сравнение
   *  не должно вызывать рендер. */
  const previous = useRef<UpdatesSnapshot | null>(null);

  const loadNotifications = useCallback(async (): Promise<void> => {
    // Только непрочитанные: колокольчик — это «что ждёт внимания», а не архив.
    // Просмотренное исчезает из списка (см. markRead ниже), иначе лента
    // превращается в свалку, где непонятно, что уже видел.
    const response = await api.get<{ items: NotificationItem[]; unread: number }>(
      '/notifications?limit=20&unreadOnly=true',
    );
    setNotifications(response.items);
    setUnread(response.unread);
  }, []);

  const poll = useCallback(async (): Promise<void> => {
    const snapshot = await api.get<UpdatesSnapshot>('/updates');
    const prev = previous.current;
    previous.current = snapshot;

    if (prev) {
      if (
        prev.tickets.count !== snapshot.tickets.count ||
        prev.tickets.maxUpdatedAt !== snapshot.tickets.maxUpdatedAt
      ) {
        setTicketsTick((tick) => tick + 1);
      }
      if (prev.access.lastEventAt !== snapshot.access.lastEventAt) {
        setAccessTick((tick) => tick + 1);
      }
    }

    // Ленту перезапрашиваем, только если она правда изменилась: иначе каждые
    // 5 секунд тянули бы двадцать уведомлений без причины.
    const changed =
      !prev ||
      prev.notifications.lastAt !== snapshot.notifications.lastAt ||
      prev.notifications.unread !== snapshot.notifications.unread;

    if (changed) {
      await loadNotifications();
    } else {
      setUnread(snapshot.notifications.unread);
    }
  }, [loadNotifications]);

  useEffect(() => {
    // При выходе состояние не сбрасываем вручную: провайдер перемонтируется
    // по смене статуса (см. LiveUpdates в App.tsx), и это чище, чем setState
    // внутри эффекта — он вызывал бы лишний рендер.
    if (status !== 'authenticated') return;

    let cancelled = false;
    /** Последнее сообщение об ошибке — чтобы не спамить в консоль каждые 5 с. */
    let lastWarning = '';

    const tick = async () => {
      if (document.hidden) return;
      try {
        await poll();
        lastWarning = '';
      } catch (err) {
        // Молчать нельзя: самая частая причина — на сервере старый код без
        // /updates (или он упал). Без этого сообщения «ничего не обновляется»
        // выглядит как загадка, и искать приходится наугад.
        const message = err instanceof Error ? err.message : String(err);
        if (message !== lastWarning) {
          lastWarning = message;
          console.warn('[updates] опрос не удался — живые обновления не работают:', message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);

    // Вернулись на вкладку — обновляемся сразу, не ждём 5 секунд
    const onVisibility = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status, poll]);

  const markRead = useCallback(async (id: string): Promise<void> => {
    // Не просто гасим подсветку, а убираем строку: просмотренное не должно
    // висеть в списке. Счётчик уменьшаем сразу, не дожидаясь ответа сервера.
    setNotifications((items) => items.filter((item) => item.id !== id));
    setUnread((count) => Math.max(0, count - 1));

    try {
      await api.post(`/notifications/${id}/read`, {});
    } catch {
      // Не удалось — сервер вернёт правду при следующем опросе
    }
  }, []);

  const markAllRead = useCallback(async (): Promise<void> => {
    setNotifications([]);
    setUnread(0);

    try {
      await api.post('/notifications/read-all', {});
    } catch {
      /* см. markRead */
    }
  }, []);

  const refresh = useCallback(() => void poll(), [poll]);

  return (
    <UpdatesContext.Provider
      value={{
        ticketsTick,
        accessTick,
        notifications,
        unread,
        loading,
        markRead,
        markAllRead,
        refresh,
      }}
    >
      {children}
    </UpdatesContext.Provider>
  );
}
