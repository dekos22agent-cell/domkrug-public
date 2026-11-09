/**
 * Привязки жителей к квартирам.
 *
 * Две разные выборки, поэтому два хука:
 *   - своя (житель): `GET /resident/bindings`;
 *   - очередь УК: `GET /resident-bindings`.
 * Права проверяет сервер, клиент лишь решает, что показать.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Binding, Page, TenantBindingItem } from './types';

interface AsyncResult<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Свои привязки жителя. */
export function useMyBindings(): AsyncResult<Binding> {
  const [items, setItems] = useState<Binding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const requestKey = `my|${reloadKey}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get<{ items: Binding[] }>('/resident/bindings');
        if (cancelled) return;
        setItems(response.items);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Не удалось загрузить привязки');
        setItems([]);
      } finally {
        if (!cancelled) setLoadedKey(requestKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  return { items, loading: loadedKey !== requestKey, error, reload };
}

/** Очередь привязок на стороне УК, с фильтром по статусу. */
export function useTenantBindings(status: 'pending' | 'confirmed' | 'rejected' | 'all'): AsyncResult<TenantBindingItem> {
  const [items, setItems] = useState<TenantBindingItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const requestKey = `${status}|${reloadKey}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (status !== 'all') params.set('status', status);
        const page = await api.get<Page<TenantBindingItem>>(
          `/resident-bindings?${params.toString()}`,
        );
        if (cancelled) return;
        setItems(page.items);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Не удалось загрузить заявки на привязку');
        setItems([]);
      } finally {
        if (!cancelled) setLoadedKey(requestKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, requestKey]);

  return { items, loading: loadedKey !== requestKey, error, reload };
}
