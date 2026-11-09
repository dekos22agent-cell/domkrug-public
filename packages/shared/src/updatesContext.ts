/**
 * Живые обновления: контекст и хук.
 *
 * Задача одна на всё приложение: страницы должны сами узнавать о новых
 * заявках, ответах УК и открытиях дверей. Поэтому не «каждый экран опрашивает
 * своё», а один провайдер держит один опрос и раздаёт счётчики изменений.
 *
 * Почему опрос, а не WebSocket/SSE — объяснено в backend/src/modules/updates.
 * Коротко: на пилоте это дешевле и не ломается при перезапуске службы.
 */

import { createContext, useContext } from 'react';
import type { NotificationItem } from './types';

export interface UpdatesState {
  /** Меняется, когда изменились заявки, видимые этому пользователю. */
  ticketsTick: number;
  /** Меняется, когда появилось новое событие доступа (журнал дверей). */
  accessTick: number;
  /** Последние уведомления для колокольчика. */
  notifications: NotificationItem[];
  /** Непрочитанных всего, а не только в загруженной пачке. */
  unread: number;
  /** Первая загрузка уведомлений ещё не завершилась. */
  loading: boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Принудительно обновить уведомления (например, после действия). */
  refresh: () => void;
}

export const UpdatesContext = createContext<UpdatesState | null>(null);

export function useUpdates(): UpdatesState {
  const context = useContext(UpdatesContext);
  if (!context) {
    throw new Error('useUpdates используется вне UpdatesProvider');
  }
  return context;
}
