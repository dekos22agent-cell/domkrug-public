/**
 * Активная квартира и права на неё.
 *
 * Квартира может быть доступна двумя путями: как владельцу (подтверждённая
 * привязка УК) или как приглашённому члену (семья, ребёнок, рабочий).
 * Раньше контекст знал только про привязки, поэтому член семьи видел
 * «адрес не привязан» и все плитки сразу.
 *
 * Здесь оба источника сводятся в один список, и каждая квартира несёт свои
 * права. Интерфейс спрашивает `can('access.open')`, а не угадывает по роли.
 */
import { createContext, useContext } from 'react';

/** Все права владельца: он видит и может всё. */
export const OWNER_SCOPES = [
  'access.open',
  'access.entrance_door',
  'access.wicket',
  'access.barrier',
  'access.gate',
  'access.parking',
  'video.view',
  'meters.submit',
  'tickets.create',
  'finance.view',
  'members.manage',
];

export interface ApartmentAccess {
  /** Ключ для переключателя: id привязки или id членства */
  id: string;
  apartmentId: string;
  apartmentNumber: string;
  addressText: string;
  buildingId: string;
  tenantId: string;
  tenantName: string;
  /** Владелец — значит все права без исключений */
  isOwner: boolean;
  scopes: string[];
  /** Срок доступа для рабочего и гостя */
  expiresAt: string | null;
  /** Кто дал доступ (для чужих квартир) */
  grantedByName: string | null;
  /** 'owner' — своя, 'granted' — выданная другим человеком */
  relation: 'owner' | 'granted';
}

export interface ApartmentState {
  apartments: ApartmentAccess[];
  active: ApartmentAccess | null;
  setActive: (id: string) => void;
  /** Есть ли право у текущей квартиры */
  can: (scope: string) => boolean;
  /**
   * Есть ли право хотя бы на одной квартире.
   *
   * Нужно для разделов, которые не зависят от выбранной квартиры: добавить
   * квартиру или пригласить человека можно, даже если сейчас открыта чужая
   * квартира по доступу.
   */
  canAny: (scope: string) => boolean;
}

export const ApartmentContext = createContext<ApartmentState | null>(null);

export function useApartment(): ApartmentState {
  const context = useContext(ApartmentContext);
  if (!context) {
    throw new Error('useApartment используется вне ApartmentProvider');
  }
  return context;
}
