/**
 * Доступ: точки и журнал.
 *
 * Открытие — команда на сервер, а не в устройство. Сервер проверяет, что
 * человек действительно живёт в квартире, которой выдан доступ, и только
 * потом зовёт провайдера. Поэтому даже подделанный запрос из браузера
 * не откроет чужой подъезд.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { AccessEvent, AccessPoint } from './types';
import { useUpdates } from './updatesContext';

interface AccessPointsState {
  items: AccessPoint[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useAccessPoints(): AccessPointsState {
  const [state, setState] = useState<{
    items: AccessPoint[];
    loading: boolean;
    error: string | null;
  }>({ items: [], loading: true, error: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await api.get<{ items: AccessPoint[] }>('/resident/access/points');
        if (cancelled) return;
        setState({ items: response.items, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          items: [],
          loading: false,
          error: err instanceof Error ? err.message : 'Не удалось загрузить точки доступа',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [version]);

  // Перезагрузку запускаем из обработчика, а не из эффекта: setState внутри
  // эффекта даёт лишний рендер и лишнюю точку рассинхронизации.
  const reload = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true }));
    setVersion((value) => value + 1);
  }, []);

  return { ...state, reload };
}

interface AccessEventsState {
  items: AccessEvent[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useAccessEvents(limit = 20): AccessEventsState {
  const [items, setItems] = useState<AccessEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // Журнал открытий должен пополняться сам: дверь могли открыть с другого
  // телефона или из подъезда, и смотреть на устаревший список неправильно
  const { accessTick } = useUpdates();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await api.get<{ items: AccessEvent[] }>(
          `/resident/access/events?limit=${limit}`,
        );
        if (cancelled) return;
        setItems(response.items);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Не удалось загрузить журнал');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // accessTick вне version: перезапрашиваем фоном, без индикатора загрузки
  }, [limit, version, accessTick]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  return { items, loading, error, reload };
}

export interface OpenOutcome {
  ok: boolean;
  message: string;
}

/** Открыть точку. Ошибки возвращаем текстом, а не бросаем: это ожидаемый путь. */
export async function openAccessPoint(
  pointId: string,
  source: 'app' | 'widget' = 'app',
): Promise<OpenOutcome> {
  try {
    const response = await api.post<{ message: string }>(
      `/resident/access/points/${pointId}/open`,
      { source },
    );
    return { ok: true, message: response.message };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, message: err.message };
    return { ok: false, message: 'Не удалось открыть. Проверьте связь и попробуйте ещё раз.' };
  }
}
