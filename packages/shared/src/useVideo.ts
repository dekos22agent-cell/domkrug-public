/**
 * Камеры и видеозвонки.
 *
 * Поток запрашивается отдельным вызовом и живёт ограниченное время: ссылку
 * нельзя сохранить в закладки и переслать. В демо-режиме сервер честно
 * возвращает demo=true и url=null — плеер покажет заглушку.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import type { ActiveCall, CameraStream, IntercomCallRecord, ResidentCamera } from './types';

export function useCameras() {
  const [state, setState] = useState<{
    items: ResidentCamera[];
    loading: boolean;
    error: string | null;
  }>({ items: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get<{ items: ResidentCamera[] }>('/resident/video/cameras');
        if (cancelled) return;
        setState({ items: response.items, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          items: [],
          loading: false,
          error: err instanceof Error ? err.message : 'Не удалось загрузить камеры',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/** Запросить ссылку на поток. Возвращает null, если доступа нет. */
export async function requestStream(cameraId: string): Promise<CameraStream | null> {
  try {
    return await api.get<CameraStream>(`/resident/video/cameras/${cameraId}/stream`);
  } catch (err) {
    if (err instanceof ApiError) return null;
    return null;
  }
}

/**
 * Активный звонок в домофон.
 *
 * Опрос раз в 2 секунды.
 *
 * Было 5 — и этого не хватило: панель звонит несколько секунд, а окно могло
 * «проскочить» ровно между двумя опросами. При 5 секундах оставался один шанс
 * из трёх, при 2 — из пяти-шести. Запрос лёгкий (одна строка из базы).
 * Полноценное решение — push-событие по WebSocket; до него ещё не дошли.
 */
export function useActiveCall(pollMs = 2000) {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<{ call: ActiveCall | null }>(
        '/resident/video/intercom/active',
      );
      setCall(response.call);
    } catch {
      setCall(null);
    }
  }, []);

  useEffect(() => {
    // Первый запрос — через таймер, а не сразу: так в эффекте нет
    // синхронного обновления состояния, и лишнего рендера при монтировании
    // тоже нет.
    const first = window.setTimeout(() => void refresh(), 0);
    timer.current = window.setInterval(() => void refresh(), pollMs);
    return () => {
      window.clearTimeout(first);
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [refresh, pollMs]);

  return { call, refresh };
}

export async function startDemoCall(apartmentId?: string): Promise<ActiveCall | null> {
  try {
    const response = await api.post<{ call: ActiveCall }>('/resident/video/intercom/demo-call', {
      apartmentId,
    });
    return response.call;
  } catch {
    return null;
  }
}

export async function openFromCall(callId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await api.post<{ message: string }>(
      `/resident/video/intercom/${callId}/open`,
      {},
    );
    return { ok: true, message: response.message };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof ApiError ? err.message : 'Не удалось открыть',
    };
  }
}

export async function declineCall(callId: string): Promise<boolean> {
  try {
    await api.post(`/resident/video/intercom/${callId}/decline`, {});
    return true;
  } catch {
    return false;
  }
}

/**
 * История звонков в домофон.
 *
 * Житель видит, что звонили, пока его не было: пропущенный вызов не должен
 * исчезать бесследно. Обновляется вместе с экраном, отдельный опрос не нужен.
 */
export function useIntercomHistory(limit = 10) {
  const [state, setState] = useState<{
    items: IntercomCallRecord[];
    loading: boolean;
    error: string | null;
  }>({ items: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get<{ items: IntercomCallRecord[] }>(
          `/resident/video/intercom/history?limit=${limit}`,
        );
        if (cancelled) return;
        setState({ items: response.items, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          items: [],
          loading: false,
          error: err instanceof ApiError ? err.message : 'Не удалось загрузить историю звонков',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return state;
}