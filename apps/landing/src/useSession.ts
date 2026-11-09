/**
 * Сессия для главной страницы.
 *
 * Отдельный хук, а не общий AuthProvider: витрине не нужны права, привязки
 * и обновление токена. Достаточно спросить у сервера «кто вошёл» — и не
 * трогать refresh-токен, чтобы не ротировать его на каждом заходе.
 *
 * Запрос идёт на `/auth/session`: сервер проверяет httpOnly-cookie и
 * возвращает имя и роли. Без cookie — 401, и главная показывает «Войти».
 */
import { useCallback, useEffect, useState } from 'react';

interface SessionUser {
  id: string;
  fullName: string;
}

interface SessionResponse {
  user: SessionUser;
  roles: string[];
}

export interface SessionState {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: SessionUser | null;
  roles: string[];
  logout: () => Promise<void>;
}

export function useSession(): SessionState {
  const [state, setState] = useState<{
    status: SessionState['status'];
    user: SessionUser | null;
    roles: string[];
  }>({ status: 'loading', user: null, roles: [] });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/v1/auth/session', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          if (!cancelled) setState({ status: 'anonymous', user: null, roles: [] });
          return;
        }

        const data = (await response.json()) as SessionResponse;
        if (!cancelled) {
          setState({ status: 'authenticated', user: data.user, roles: data.roles });
        }
      } catch {
        // Сеть или API недоступны — главная работает как для гостя
        if (!cancelled) setState({ status: 'anonymous', user: null, roles: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // Если сервер не ответил, локально всё равно показываем «Войти»
    }
    setState({ status: 'anonymous', user: null, roles: [] });
  }, []);

  return { ...state, logout };
}
