/**
 * Загрузка списка заявок.
 *
 * Свой хук вместо React Query: нужен ровно один сценарий — загрузить страницу
 * и уметь перезагрузить. Библиотека тут добавила бы больше, чем сэкономила
 * (docs/DECISIONS.md).
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Page, TicketSummary } from './types';
import { useUpdates } from './updatesContext';

interface UseTicketListResult {
  items: TicketSummary[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useTicketList(path: string): UseTicketListResult {
  const [items, setItems] = useState<TicketSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Сигнал от провайдера обновлений: заявки изменились у кого-то ещё
  const { ticketsTick } = useUpdates();

  // Ключ запроса однозначно описывает «какие данные мы просим».
  // loading вычисляется сравнением с ключом, который уже загружен, —
  // так не нужен setState в теле эффекта (это вызывает лишний рендер).
  const requestKey = `${path}|${reloadKey}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const page = await api.get<Page<TicketSummary>>(path);
        if (cancelled) return;
        setItems(page.items);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Не удалось загрузить заявки');
        setItems([]);
      } finally {
        // Отмечаем, что именно этот запрос отработан. Дальше loading
        // посчитается сам: ключ совпал — значит уже не грузимся.
        if (!cancelled) setLoadedKey(requestKey);
      }
    })();

    return () => {
      cancelled = true;
    };
    // ticketsTick в зависимостях, но НЕ в requestKey: список перезапрашивается
    // в фоне, без мигания «Загружаем…». Если положить его в ключ, loading
    // становился бы true каждые несколько секунд.
  }, [path, requestKey, ticketsTick]);

  return { items, loading, error, reload };
}
