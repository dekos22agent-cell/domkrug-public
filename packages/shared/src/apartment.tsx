/**
 * Провайдер активной квартиры.
 *
 * Собирает квартиры из двух источников: подтверждённые привязки (владелец)
 * и активные членства (приглашённые). Дальше интерфейс работает с одним
 * списком и спрашивает права через `can()`, не разбираясь, откуда пришла
 * квартира.
 *
 * Выбор хранится в localStorage: после перезагрузки человек возвращается
 * в ту же квартиру. Если выбор стал невалидным (привязку отозвали,
 * приглашение истекло) — откат на первую доступную.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ApartmentContext, OWNER_SCOPES, type ApartmentAccess } from './apartmentContext';
import { useAuth } from './authContext';

const STORAGE_KEY = 'liviti.activeApartment';

function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeId(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Приватный режим — выбор сохранится только на сессию
  }
}

export function ApartmentProvider({ children }: { children: ReactNode }) {
  const { bindings, memberships } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(() => readStoredId());

  const apartments = useMemo<ApartmentAccess[]>(() => {
    const fromBindings: ApartmentAccess[] = bindings
      .filter((binding) => binding.status === 'confirmed')
      .map((binding) => ({
        id: `binding:${binding.id}`,
        apartmentId: binding.apartmentId,
        apartmentNumber: binding.apartmentNumber,
        addressText: binding.addressText,
        buildingId: binding.buildingId,
        tenantId: binding.tenantId,
        tenantName: binding.tenantName,
        isOwner: true,
        scopes: OWNER_SCOPES,
        expiresAt: null,
        grantedByName: null,
        relation: 'owner',
      }));

    const fromMemberships: ApartmentAccess[] = (memberships ?? []).map((membership) => ({
      id: `member:${membership.apartmentId}`,
      apartmentId: membership.apartmentId,
      apartmentNumber: membership.apartmentNumber,
      addressText: membership.addressText,
      buildingId: membership.buildingId,
      tenantId: membership.tenantId,
      tenantName: membership.tenantName,
      isOwner: false,
      scopes: membership.scopes,
      expiresAt: membership.expiresAt,
      grantedByName: membership.invitedByName,
      relation: 'granted',
    }));

    // Владельческие квартиры идут первыми: если человек и собственник,
    // и приглашён в другую квартиру, начинать логичнее со своей
    return [...fromBindings, ...fromMemberships];
  }, [bindings, memberships]);

  const active = useMemo(() => {
    if (apartments.length === 0) return null;
    return apartments.find((item) => item.id === selectedId) ?? apartments[0] ?? null;
  }, [apartments, selectedId]);

  const setActive = useCallback((id: string) => {
    setSelectedId(id);
    storeId(id);
  }, []);

  const can = useCallback(
    (scope: string) => {
      if (!active) return false;
      if (active.isOwner) return true;
      // «access.open» в интерфейсе означает «раздел доступа доступен».
      // Конкретную точку сервер всё равно проверит по типу:
      // access.wicket, access.barrier и т. д.
      if (scope === 'access.open') {
        return active.scopes.some(
          (item) => item === 'access.open' || item.startsWith('access.'),
        );
      }
      return active.scopes.includes(scope);
    },
    [active],
  );

  const canAny = useCallback(
    (scope: string) =>
      apartments.some((apartment) => {
        if (apartment.isOwner) return true;
        if (scope === 'access.open') {
          return apartment.scopes.some(
            (item) => item === 'access.open' || item.startsWith('access.'),
          );
        }
        return apartment.scopes.includes(scope);
      }),
    [apartments],
  );

  const value = useMemo(
    () => ({ apartments, active, setActive, can, canAny }),
    [apartments, active, setActive, can, canAny],
  );

  return <ApartmentContext.Provider value={value}>{children}</ApartmentContext.Provider>;
}
