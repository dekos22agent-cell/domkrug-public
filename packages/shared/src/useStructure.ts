/**
 * Дома и квартиры для сотрудников УК.
 *
 * Здесь только структура и номер на вызывной панели: заявки, жители и права
 * живут в своих хуках. Общий список домов нужен на нескольких экранах,
 * поэтому запрос вынесен сюда.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type {
  ApartmentListItem,
  BuildingListItem,
  BuildingPassport,
  OwnerListItem,
  SaveOwnerInput,
  SaveStaffMeterInput,
  StaffMeterItem,
} from './types';

interface ListState<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function useList<T>(path: string | null): ListState<T> {
  const [state, setState] = useState<{ items: T[]; loading: boolean; error: string | null }>({
    items: [],
    loading: Boolean(path),
    error: null,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get<{ items: T[] }>(path);
        if (cancelled) return;
        setState({ items: response.items, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          items: [],
          loading: false,
          error: err instanceof ApiError ? err.message : 'Не удалось загрузить список',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true }));
    setVersion((value) => value + 1);
  }, []);

  return { ...state, reload };
}

/** Дома УК. Нужны для выбора дома на экране квартир. */
export function useBuildings(): ListState<BuildingListItem> {
  return useList<BuildingListItem>('/buildings');
}

/** Квартиры дома вместе с номером на вызывной панели. */
export function useApartments(buildingId: string | null, search = ''): ListState<ApartmentListItem> {
  const query = new URLSearchParams();
  query.set('limit', '100');
  if (search.trim()) query.set('q', search.trim());
  const path = buildingId ? `/buildings/${buildingId}/apartments?${query.toString()}` : null;
  return useList<ApartmentListItem>(path);
}

/** Паспорт объекта: сам объект, паспортные поля и фактический состав. */
export function useBuildingPassport(buildingId: string | null): {
  data: BuildingPassport | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [state, setState] = useState<{
    data: BuildingPassport | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: Boolean(buildingId), error: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!buildingId) return;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    (async () => {
      try {
        const response = await api.get<BuildingPassport>(`/buildings/${buildingId}/passport`);
        if (!cancelled) setState({ data: response, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          error: err instanceof ApiError ? err.message : 'Не удалось загрузить паспорт объекта',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buildingId, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { ...state, reload };
}

export interface PassportSaveInput {
  objectKind: BuildingPassport['building']['objectKind'];
  yearBuilt: number | null;
  totalFloors: number | null;
  totalEntrances: number | null;
  cadastralNumber: string | null;
  yearCommissioned: number | null;
  totalArea: number | null;
  livingArea: number | null;
  commercialArea: number | null;
  landArea: number | null;
  parkingSpots: number | null;
  elevatorsCount: number | null;
  energyClass: string | null;
  managementStart: string | null;
  warrantyUntil: string | null;
  notes: string | null;
}

export async function saveBuildingPassport(
  buildingId: string,
  input: PassportSaveInput,
): Promise<BuildingPassport> {
  return api.put<BuildingPassport>(`/buildings/${buildingId}/passport`, input);
}

/** Собственники и доли по объекту. */
export function useOwners(buildingId: string | null): ListState<OwnerListItem> {
  return useList<OwnerListItem>(buildingId ? `/buildings/${buildingId}/owners` : null);
}

export async function createOwner(
  buildingId: string,
  apartmentId: string,
  input: SaveOwnerInput,
): Promise<OwnerListItem> {
  return api.post<OwnerListItem>(
    `/buildings/${buildingId}/apartments/${apartmentId}/owners`,
    input,
  );
}

export async function updateOwner(
  buildingId: string,
  ownershipId: string,
  input: SaveOwnerInput,
): Promise<OwnerListItem> {
  return api.patch<OwnerListItem>(`/buildings/${buildingId}/owners/${ownershipId}`, input);
}

export async function removeOwner(buildingId: string, ownershipId: string): Promise<void> {
  await api.delete<void>(`/buildings/${buildingId}/owners/${ownershipId}`);
}

export interface ApartmentSaveInput {
  kind: string;
  rooms: number | null;
  areaTotal: number | null;
  status: 'active' | 'archived';
}

export interface ImportApartmentRow {
  number: string;
  kind: 'apartment' | 'nonresidential' | 'house' | 'office' | 'retail' | 'parking' | 'storage';
  rooms: number | null;
  areaTotal: number | null;
}

export async function importApartmentRows(
  buildingId: string,
  rows: ImportApartmentRow[],
): Promise<{ created: number; skipped: number }> {
  return api.post<{ created: number; skipped: number }>(
    `/buildings/${buildingId}/apartments/import`,
    { rows },
  );
}

export async function saveApartmentDetails(
  buildingId: string,
  apartmentId: string,
  input: ApartmentSaveInput,
): Promise<void> {
  await api.patch(`/buildings/${buildingId}/apartments/${apartmentId}`, input);
}

export function useBuildingMeters(buildingId: string | null): ListState<StaffMeterItem> {
  return useList<StaffMeterItem>(buildingId ? `/buildings/${buildingId}/meters` : null);
}

export async function createStaffMeter(
  buildingId: string,
  apartmentId: string,
  input: SaveStaffMeterInput,
): Promise<StaffMeterItem> {
  return api.post<StaffMeterItem>(
    `/buildings/${buildingId}/apartments/${apartmentId}/meters`,
    input,
  );
}

export async function updateStaffMeter(
  buildingId: string,
  meterId: string,
  input: SaveStaffMeterInput,
): Promise<StaffMeterItem> {
  return api.patch<StaffMeterItem>(`/buildings/${buildingId}/meters/${meterId}`, input);
}

export async function deactivateStaffMeter(buildingId: string, meterId: string): Promise<void> {
  await api.delete<void>(`/buildings/${buildingId}/meters/${meterId}`);
}

export interface RoomSaveResult {
  ok: boolean;
  message: string;
}/**
 * Задать номер на панели для одной квартиры.
 *
 * Пустая строка значит «снять номер»: без номера звонок в эту квартиру
 * не маршрутизируется, и это лучше, чем звонить не туда.
 */
export async function saveApartmentRoom(
  buildingId: string,
  apartmentId: string,
  room: string,
): Promise<RoomSaveResult> {
  try {
    await api.patch(`/buildings/${buildingId}/apartments/${apartmentId}/room`, {
      room: room.trim() === '' ? null : room.trim(),
    });
    return { ok: true, message: 'Номер сохранён' };
  } catch (err) {
    if (err instanceof ApiError) {
      // 409 значит «номер занят» — на объекте это частая ошибка ввода
      return { ok: false, message: err.message };
    }
    return { ok: false, message: 'Не удалось сохранить номер' };
  }
}

export interface AutofillResult {
  ok: boolean;
  message: string;
  filled?: number;
  skipped?: number;
}

export async function autofillApartmentRooms(buildingId: string): Promise<AutofillResult> {
  try {
    const response = await api.post<{ filled: number; skipped: number }>(
      `/buildings/${buildingId}/apartments/rooms/autofill`,
      {},
    );
    const { filled, skipped } = response;
    const tail = skipped > 0 ? ` Осталось вручную: ${skipped}.` : '';
    return {
      ok: true,
      message: filled > 0 ? `Заполнено номеров: ${filled}.${tail}` : `Заполнять нечего.${tail}`,
      filled,
      skipped,
    };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, message: err.message };
    return { ok: false, message: 'Не удалось заполнить номера' };
  }
}
