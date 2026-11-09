/**
 * Загрузка одной заявки.
 *
 * Адрес зависит от роли:
 *   сотрудники УК — `/tickets/:id` (сервер сам ограничит область: диспетчер
 *   видит всю УК, исполнитель — только свои);
 *   житель — `/resident/tickets/:id`.
 * Клиент выбирает путь по правам, но настоящая проверка — на сервере.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { TicketDetail } from './types';
import { useUpdates } from './updatesContext';

interface TicketEntry {
  /** Ключ запроса, к которому относится результат. */
  key: string;
  ticket: TicketDetail | null;
  error: string | null;
}

interface UseTicketResult {
  ticket: TicketDetail | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useTicket(id: string | undefined, forStaff: boolean): UseTicketResult {
  const [entry, setEntry] = useState<TicketEntry | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Карточка тоже обновляется сама: исполнитель меняет статус, а житель
  // в этот момент смотрит на экран и не должен нажимать F5
  const { ticketsTick } = useUpdates();

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  const requestKey = `${id ?? 'none'}|${forStaff}|${reloadKey}`;

  // Результат относится к текущему запросу? Если нет — значит ещё грузимся.
  // Так не нужен setState в теле эффекта (он вызывает лишний рендер).
  const current = entry && entry.key === requestKey ? entry : null;

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    (async () => {
      try {
        const path = forStaff ? `/tickets/${id}` : `/resident/tickets/${id}`;
        const data = await api.get<TicketDetail>(path);
        if (cancelled) return;
        setEntry({ key: requestKey, ticket: data, error: null });
      } catch (err) {
        if (cancelled) return;
        setEntry({
          key: requestKey,
          ticket: null,
          error: err instanceof Error ? err.message : 'Не удалось загрузить заявку',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // ticketsTick не входит в requestKey: обновление фоновое, без мигания
    // «Загружаем…» на каждом опросе
  }, [id, forStaff, requestKey, ticketsTick]);

  if (!id) {
    return { ticket: null, loading: false, error: 'Заявка не найдена', reload };
  }

  return {
    ticket: current?.ticket ?? null,
    loading: current === null,
    error: current?.error ?? null,
    reload,
  };
}
