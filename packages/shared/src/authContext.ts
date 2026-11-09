/**
 * Контекст авторизации и хук доступа к нему.
 *
 * Вынесено из auth.tsx отдельным файлом: там остаётся только компонент
 * AuthProvider, поэтому Fast Refresh работает и правка провайдера не
 * вызывает полную перезагрузку страницы.
 */

import { createContext, useContext } from 'react';
import type { Binding, CurrentUser, Membership, StaffTenant, TwoFactorState } from './types';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

/** Данные для регистрации жителя. */
export interface RegisterInput {
  fullName: string;
  phone: string;
  email?: string;
  password: string;
}

export interface AuthState {
  status: AuthStatus;
  user: CurrentUser | null;
  roles: string[];
  permissions: string[];
  tenant: StaffTenant | null;
  bindings: Binding[];
  /** Квартиры, куда пригласили (семья, дети, рабочие). */
  memberships: Membership[];
  /** Состояние второго фактора; null, пока профиль не загружен. */
  twoFactor: TwoFactorState | null;
  /**
   * Ошибка входа или регистрации для показа на форме.
   * Сбрасывается при новой попытке.
   */
  authError: string | null;
  /**
   * Код ошибки API (`TOTP_REQUIRED`, `INVALID_TOTP`, …). Нужен форме входа,
   * чтобы отличить «нужен код» от «неверный пароль» и показать поле.
   */
  authErrorCode: string | null;
  /** Идёт вход или регистрация — кнопки блокируются. */
  isSubmitting: boolean;
  /**
   * Вход. `totpCode` передаётся, если сервер ответил TOTP_REQUIRED
   * или пользователь повторил попытку с кодом.
   */
  login: (identifier: string, password: string, totpCode?: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Перечитать профиль после его изменения (имя, почта, дата рождения). */
  refreshUser: () => Promise<void>;
  hasPermission: (code: string) => boolean;
  hasRole: (code: string) => boolean;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth используется вне AuthProvider');
  }
  return context;
}
