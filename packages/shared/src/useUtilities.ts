/**
 * Счётчики, лифты, экстренные вызовы — загрузка и действия.
 *
 * Все три блока устроены одинаково: список + действие. Общий файл, чтобы
 * не плодить три почти одинаковых хука с одинаковой обработкой ошибок.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type {
  AnnouncementItem,
  AuditEntry,
  DocumentItem,
  EmergencyCall,
  EmergencyMessage,
  Lift,
  Meter,
  NewsItem,
  StaffContact,
  StaffMember,
} from './types';

interface ListState<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function useList<T>(path: string): ListState<T> {
  const [state, setState] = useState<{ items: T[]; loading: boolean; error: string | null }>({
    items: [],
    loading: true,
    error: null,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
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
          error: err instanceof Error ? err.message : 'Не удалось загрузить данные',
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

export function useMeters(): ListState<Meter> {
  return useList<Meter>('/resident/meters');
}

export function useNews(): ListState<NewsItem> {
  return useList<NewsItem>('/resident/news');
}

/**
 * Единая лента сообщений УК: объявления и экстренные предупреждения.
 *
 * В базе это две таблицы, но жителю важно не разбираться в нашей схеме,
 * а видеть одно место, где УК пишет ему. Экстренные сообщения помечаем
 * как важные; дубликаты по id разных таблиц не пересекаются.
 */
export function useAnnouncements(): ListState<AnnouncementItem> {
  const news = useNews();
  const emergency = useEmergencyMessages();

  const items: AnnouncementItem[] = [
    ...news.items.map((item) => ({
      id: `news:${item.id}`,
      title: item.title,
      body: item.body,
      publishedAt: item.publishedAt ?? item.createdAt,
      isEmergency: item.isEmergency,
      source: 'news' as const,
    })),
    ...emergency.items.map((item) => ({
      id: `emergency:${item.id}`,
      title: item.title,
      body: item.body,
      publishedAt: item.publishedAt,
      isEmergency: item.severity !== 'info',
      source: 'emergency' as const,
    })),
  ].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  return {
    items,
    loading: news.loading || emergency.loading,
    error: news.error ?? emergency.error,
    reload: () => {
      news.reload();
      emergency.reload();
    },
  };
}

export function useStaffNews(): ListState<NewsItem> {
  return useList<NewsItem>('/news');
}

export function useDocuments(): ListState<DocumentItem> {
  return useList<DocumentItem>('/resident/documents');
}

export function useStaffDocuments(): ListState<DocumentItem> {
  return useList<DocumentItem>('/documents');
}

export function useStaffAccounts(): ListState<StaffMember> {
  return useList<StaffMember>('/staff');
}

export function useStaffContacts(): ListState<StaffContact> {
  return useList<StaffContact>('/contacts');
}

export function useAuditEntries(): ListState<AuditEntry> {
  return useList<AuditEntry>('/audit?limit=100');
}

export function useLifts(): ListState<Lift> {
  return useList<Lift>('/resident/lifts');
}

export function useEmergencyMessages(): ListState<EmergencyMessage> {
  return useList<EmergencyMessage>('/resident/emergency/messages');
}

export function useContacts() {
  return useList<{
    id: string;
    kind: 'uk' | 'district' | 'provider' | 'clinic' | 'emergency' | 'other';
    name: string;
    phone: string;
    note: string | null;
    buildingAddress: string | null;
  }>('/resident/contacts');
}

export function useEmergencyCalls(): ListState<EmergencyCall> {
  return useList<EmergencyCall>('/resident/emergency/calls');
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

function toError(err: unknown, fallback: string): ActionResult {
  if (err instanceof ApiError) return { ok: false, message: err.message };
  return { ok: false, message: fallback };
}

/** Передать показание счётчика. */
export async function submitMeterReading(meterId: string, value: number): Promise<ActionResult> {
  try {
    const response = await api.post<{ updated: boolean }>(
      `/resident/meters/${meterId}/readings`,
      { value },
    );
    return {
      ok: true,
      message: response.updated ? 'Показание обновлено' : 'Показание принято',
    };
  } catch (err) {
    return toError(err, 'Не удалось передать показание');
  }
}

export async function callLift(liftId: string): Promise<ActionResult> {
  try {
    const response = await api.post<{ message: string }>(`/resident/lifts/${liftId}/call`, {});
    return { ok: true, message: response.message };
  } catch (err) {
    return toError(err, 'Не удалось вызвать лифт');
  }
}

export async function reportLiftFault(
  liftId: string,
  note: string,
): Promise<ActionResult & { ticketNumber?: number | null }> {
  try {
    const response = await api.post<{ message: string; ticketNumber: number | null }>(
      `/resident/lifts/${liftId}/fault`,
      { note: note.trim() || undefined },
    );
    return { ok: true, message: response.message, ticketNumber: response.ticketNumber };
  } catch (err) {
    return toError(err, 'Не удалось передать сообщение');
  }
}

export async function createEmergencyCall(
  kind: EmergencyCall['kind'],
  locationNote?: string,
): Promise<{ ok: boolean; message: string; call?: EmergencyCall }> {
  try {
    const response = await api.post<{ call: EmergencyCall }>('/resident/emergency/calls', {
      kind,
      locationNote: locationNote?.trim() || undefined,
    });
    return { ok: true, message: 'Вызов зарегистрирован', call: response.call };
  } catch (err) {
    const failure = toError(err, 'Не удалось создать вызов');
    return failure;
  }
}

export async function cancelEmergencyCall(callId: string): Promise<ActionResult> {
  try {
    await api.post(`/resident/emergency/calls/${callId}/cancel`, {});
    return { ok: true, message: 'Вызов отменён' };
  } catch (err) {
    return toError(err, 'Не удалось отменить вызов');
  }
}

/* ─── Члены квартиры ────────────────────────────────────────────────────── */

export type MemberPreset = 'family' | 'child' | 'tenant' | 'worker' | 'guest';

export interface ApartmentMember {
  id: string;
  /** account — вход по телефону, code — по коду без ПДн */
  kind: 'account' | 'code';
  label: string | null;
  codePrefix: string | null;
  /** Код в открытом виде — только владельцу */
  code: string | null;
  phone: string | null;
  preset: MemberPreset;
  scopes: string[];
  status: 'invited' | 'active' | 'revoked';
  fullName: string | null;
  /** Приглашённый уже зарегистрировался; владельцу нужно подтвердить. */
  claimed: boolean;
  expiresAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

export function useMembers(apartmentId: string | undefined) {
  const [state, setState] = useState<{
    items: ApartmentMember[];
    loading: boolean;
    error: string | null;
  }>({ items: [], loading: Boolean(apartmentId), error: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!apartmentId) {
      // Пустая квартира — просто ничего не грузим. Состояние уже пустое
      // по умолчанию, поэтому setState здесь не нужен.
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get<{ items: ApartmentMember[] }>(
          `/resident/members?apartmentId=${apartmentId}`,
        );
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
  }, [apartmentId, version]);

  const reload = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true }));
    setVersion((value) => value + 1);
  }, []);

  return { ...state, reload };
}

export async function inviteMember(input: {
  apartmentId: string;
  phone: string;
  preset: MemberPreset;
  /** Чекбоксы «что разрешено»; если не передано — набор пресета. */
  scopes?: string[];
  expiresAt?: string;
}): Promise<{ ok: boolean; message: string; activated?: boolean }> {
  try {
    const response = await api.post<{ activated: boolean }>('/resident/members', input);
    return {
      ok: true,
      message: response.activated
        ? 'Доступ уже действует: человек в приложении'
        : 'Приглашение создано: после регистрации подтвердите человека в списке',
      activated: response.activated,
    };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, message: err.message };
    return { ok: false, message: 'Не удалось создать приглашение' };
  }
}

export async function revokeMember(apartmentId: string, memberId: string): Promise<ActionResult> {
  try {
    await api.delete(`/resident/members/${memberId}?apartmentId=${apartmentId}`);
    return { ok: true, message: 'Доступ отозван' };
  } catch (err) {
    return toError(err, 'Не удалось отозвать доступ');
  }
}

/**
 * Подтвердить приглашённого.
 *
 * Без этого шага доступ по телефону не включается: номер не проверяется
 * SMS-кодом, поэтому последнее слово остаётся за владельцем квартиры.
 */
export async function confirmMember(
  apartmentId: string,
  memberId: string,
): Promise<ActionResult> {
  try {
    await api.post(`/resident/members/${memberId}/confirm`, { apartmentId });
    return { ok: true, message: 'Доступ подтверждён' };
  } catch (err) {
    return toError(err, 'Не удалось подтвердить доступ');
  }
}
/**
 * Создать доступ по коду.
 *
 * Код возвращается один раз и больше не восстанавливается: в базе только
 * хеш. Если владелец потерял код — выпускает новый.
 */
export async function createCodeAccess(input: {
  apartmentId: string;
  preset: MemberPreset;
  /** Чекбоксы «что разрешено»; если не передано — набор пресета. */
  scopes?: string[];
  label: string;
  expiresAt?: string;
}): Promise<{ ok: boolean; message: string; code?: string }> {
  try {
    const response = await api.post<{ code: string; prefix: string }>('/resident/members/code', input);
    return { ok: true, message: 'Код создан', code: response.code };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, message: err.message };
    return { ok: false, message: 'Не удалось создать код' };
  }
}