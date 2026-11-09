/**
 * История статусов заявки.
 *
 * Нужна, чтобы видеть, кто и когда менял статус и что при этом написали.
 * Особенно важно для «ожидает материалов» и закрытия: сервер требует там
 * комментарий, и без истории он оставался бы невидимым.
 *
 * Адрес зависит от роли: у жителя свой эндпоинт (проверяет владение заявкой),
 * у сотрудников — общий (проверяет область: своя УК или назначенные заявки).
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { TicketHistoryItem } from './types';
import { useUpdates } from './updatesContext';

interface UseTicketHistoryResult {
  items: TicketHistoryItem[];
  loading: boolean;
  error: string | null;
  /**
   * Перечитать историю.
   *
   * Зачем: после смены статуса или назначения исполнителя история устаревала,
   * и новые записи появлялись только после перезагрузки страницы. Владелец
   * это заметил на телефоне — там перезагружать особенно неудобно.
   */
  reload: () => void;
}

export function useTicketHistory(id: string | undefined, forStaff: boolean): UseTicketHistoryResult {
  const [entry, setEntry] = useState<{
    key: string;
    items: TicketHistoryItem[];
    error: string | null;
  } | null>(null);
  // Счётчик перезагрузок: меняется — эффект перезапрашивает данные
  const [version, setVersion] = useState(0);
  // История меняется вместе с заявкой: подписываемся на тот же сигнал
  const { ticketsTick } = useUpdates();

  const requestKey = `${id ?? 'none'}|${forStaff}|${version}`;
  const current = entry && entry.key === requestKey ? entry : null;

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    const path = forStaff ? `/tickets/${id}/history` : `/resident/tickets/${id}/history`;

    (async () => {
      try {
        const response = await api.get<{ items: TicketHistoryItem[] }>(path);
        if (cancelled) return;
        setEntry({ key: requestKey, items: response.items, error: null });
      } catch (err) {
        if (cancelled) return;
        setEntry({
          key: requestKey,
          items: [],
          error: err instanceof Error ? err.message : 'Не удалось загрузить историю',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // ticketsTick вне requestKey: фоновое обновление без «Загружаем…»
  }, [id, forStaff, requestKey, ticketsTick]);

  const reload = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  return {
    items: current?.items ?? [],
    loading: current === null,
    error: current?.error ?? null,
    reload,
  };
}
