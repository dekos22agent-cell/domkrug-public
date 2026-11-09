/**
 * AuthProvider — состояние авторизации на всё приложение.
 *
 * Почему Context, а не библиотека: глобального состояния почти нет — пользователь
 * и токен. Единственный нетривиальный сценарий (обновление токена на 401) живёт
 * в lib/api.ts (docs/DECISIONS.md).
 *
 * Жизненный цикл:
 *   старт → refresh (восстановить сессию после F5) → /auth/me → готово
 *   вход → POST /auth/login → токен в память → /auth/me
 *   регистрация → POST /auth/register (сразу выдаёт сессию) → /auth/me
 *   выход → POST /auth/logout → токен стёрт → экран входа
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, setAccessToken, setSessionExpiredHandler } from './api';
import {
  AuthContext,
  type AuthState,
  type AuthStatus,
  type RegisterInput,
} from './authContext';
import type {
  Binding,
  CurrentUser,
  LoginResponse,
  MeResponse,
  Membership,
  StaffTenant,
  TwoFactorState,
} from './types';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [tenant, setTenant] = useState<StaffTenant | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [twoFactor, setTwoFactor] = useState<TwoFactorState | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authErrorCode, setAuthErrorCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const permissionSet = useMemo(() => new Set(permissions), [permissions]);

  const applyMe = useCallback((me: MeResponse) => {
    setUser(me.user);
    setRoles(me.roles);
    setPermissions(me.permissions);
    setTenant(me.tenant);
    setBindings(me.bindings);
    setMemberships(me.memberships ?? []);
    setTwoFactor(me.twoFactor ?? null);
  }, []);

  const reset = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setRoles([]);
    setPermissions([]);
    setTenant(null);
    setBindings([]);
    setMemberships([]);
    setTwoFactor(null);
    setAuthError(null);
    setAuthErrorCode(null);
    setStatus('anonymous');
  }, []);

  // Ссылка на актуальный reset для обработчика в api.ts:
  // подписываемся на событие один раз, а функция всегда свежая.
  // Обновляем в эффекте, а не в теле рендера — чтение/запись ref во время
  // рендера React не одобряет (и справедливо: рендер должен быть чистым).
  const resetRef = useRef(reset);
  useEffect(() => {
    resetRef.current = reset;
  }, [reset]);

  // ─── Восстановление сессии при старте ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    setSessionExpiredHandler(() => {
      resetRef.current();
    });

    (async () => {
      // После F5 access-токена нет, но refresh-cookie осталась.
      // Успешный refresh здесь — нормальный сценарий, не ошибка.
      const refreshed = await api.refresh();
      if (cancelled) return;

      if (!refreshed) {
        setStatus('anonymous');
        return;
      }

      try {
        const me = await api.get<MeResponse>('/auth/me');
        if (cancelled) return;
        applyMe(me);
        setStatus('authenticated');
      } catch {
        if (cancelled) return;
        resetRef.current();
      }
    })();

    return () => {
      cancelled = true;
      setSessionExpiredHandler(null);
    };
  }, [applyMe]);

  // ─── Вход ──────────────────────────────────────────────────────────────
  const login = useCallback(
    async (identifier: string, password: string, totpCode?: string) => {
      setAuthError(null);
      setAuthErrorCode(null);
      setIsSubmitting(true);
      try {
        // skipRefresh: на форме входа refresh не нужен и только путает —
        // пользователь ещё не авторизован.
        // Какое приложение входит: жителя или УК. Сервер не пустит чужую
        // учётку и ответит так же, как на неверный пароль.
        const audience = (import.meta.env.VITE_APP_AUDIENCE as string | undefined) ?? undefined;
        const response = await api.post<LoginResponse>(
          '/auth/login',
          {
            identifier,
            password,
            audience,
            // Код второго фактора отправляем только когда он есть: пустая
            // строка не проходит серверную валидацию
            ...(totpCode ? { totpCode } : {}),
          },
          true,
        );
        setAccessToken(response.accessToken);

        // Профиль тянем отдельным запросом: в ответе логина нет прав и привязок,
        // а маршрутизация по роли должна опираться на полный набор.
        const me = await api.get<MeResponse>('/auth/me');
        applyMe(me);
        setStatus('authenticated');
      } catch (error) {
        setAccessToken(null);
        const message =
          error instanceof Error ? error.message : 'Не удалось войти. Попробуйте ещё раз.';
        setAuthError(message);
        // TOTP_REQUIRED отличает «нужен код» от «неверный пароль»:
        // форма входа показывает поле только во втором случае
        setAuthErrorCode(error instanceof ApiError ? error.code : null);
      } finally {
        setIsSubmitting(false);
      }
    },
    [applyMe],
  );

  // ─── Регистрация ───────────────────────────────────────────────────────
  // Сервер сразу выдаёт сессию и refresh-cookie (backend/.../auth/routes.ts),
  // поэтому после регистрации человек уже внутри — остаётся привязать квартиру.
  const register = useCallback(
    async (input: RegisterInput) => {
      setAuthError(null);
      setIsSubmitting(true);
      try {
        const response = await api.post<LoginResponse>(
          '/auth/register',
          {
            fullName: input.fullName,
            phone: input.phone,
            // Пустой e-mail не отправляем: сервер ждёт либо строку, либо ничего
            ...(input.email ? { email: input.email } : {}),
            password: input.password,
            // Согласие на обработку ПДн — обязательное условие (152-ФЗ).
            // Галочка в форме не предустановлена, здесь фиксируется факт.
            consentAccepted: true,
          },
          true,
        );
        setAccessToken(response.accessToken);

        const me = await api.get<MeResponse>('/auth/me');
        applyMe(me);
        setStatus('authenticated');
      } catch (error) {
        setAccessToken(null);
        const message =
          error instanceof Error
            ? error.message
            : 'Не удалось зарегистрироваться. Попробуйте ещё раз.';
        setAuthError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [applyMe],
  );

  // ─── Выход ─────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await api.post<null>('/auth/logout', undefined, true);
    } catch {
      // Даже если сервер не ответил, локально сессию закрываем:
      // оставлять пользователя «внутри» с мёртвым токеном хуже.
    } finally {
      reset();
    }
  }, [reset]);

  /**
   * Перечитать профиль с сервера.
   *
   * Нужно после изменения данных в профиле: имя, почта и дата рождения
   * приходят в /auth/me, и без повторного запроса интерфейс показывал бы
   * старые значения до перезагрузки страницы.
   */
  const refreshUser = useCallback(async () => {
    try {
      const me = await api.get<MeResponse>('/auth/me');
      applyMe(me);
    } catch {
      // Тихо: если запрос не удался, остаются прежние данные — они валидны
    }
  }, [applyMe]);

  const hasPermission = useCallback((code: string) => permissionSet.has(code), [permissionSet]);
  const hasRole = useCallback((code: string) => roles.includes(code), [roles]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      roles,
      permissions,
      tenant,
      bindings,
      memberships,
      twoFactor,
      authError,
      authErrorCode,
      isSubmitting,
      login,
      register,
      logout,
      refreshUser,
      hasPermission,
      hasRole,
    }),
    [
      status,
      user,
      roles,
      permissions,
      tenant,
      bindings,
      memberships,
      twoFactor,
      authError,
      authErrorCode,
      isSubmitting,
      login,
      register,
      logout,
      refreshUser,
      hasPermission,
      hasRole,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

