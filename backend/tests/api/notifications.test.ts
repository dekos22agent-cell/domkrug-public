/**
 * Уведомления и сигнал обновлений.
 *
 * Проверяем то, ради чего всё делалось: житель узнаёт об ответе УК, диспетчер —
 * о новой заявке, а интерфейс может спросить «что изменилось» одним запросом.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, errorCode, login } from './helpers.js';

/** Форма ответа /notifications — проверяем ровно те поля, что нужны тесту. */
interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityId: string | null;
  readAt: string | null;
}

interface NotificationsPayload {
  items: NotificationItem[];
  unread: number;
}

/** Форма ответа /updates. */
interface UpdatesSnapshot {
  serverTime: string;
  tickets: { count: number; maxUpdatedAt: string | null };
  access: { lastEventAt: string | null };
  notifications: { unread: number; lastAt: string | null };
}

const DISPATCHER = '+79000000002';
const RESIDENT = '+79000000101';

describe('Уведомления и обновления', () => {
  let dispatcher: ApiClient;
  let resident: ApiClient;
  /** Заявка, созданная жителем в этом прогоне. */
  let ticketId = '';

  beforeAll(async () => {
    ({ client: dispatcher } = await login({ identifier: DISPATCHER }));
    ({ client: resident } = await login({ identifier: RESIDENT }));

    const bindings = await resident.get<{ items: { status: string; apartmentId: string }[] }>(
      '/resident/bindings',
    );
    const apartment = bindings.data?.items.find((item) => item.status === 'confirmed');
    expect(apartment).toBeTruthy();

    const categories = await resident.get<{ items: { id: string; isEmergency: boolean }[] }>(
      '/ticket-categories',
    );
    const category = categories.data?.items.find((item) => !item.isEmergency);
    expect(category).toBeTruthy();

    const created = await resident.post<{ id: string; number: number }>('/resident/tickets', {
      apartmentId: apartment?.apartmentId,
      categoryId: category?.id,
      description: 'Заявка из автотеста уведомлений: проверяем доставку адресату.',
      contactPhone: RESIDENT,
      priority: 'normal',
    });
    expect(created.status).toBe(201);
    ticketId = created.data?.id ?? '';
  });

  afterAll(async () => {
    // Уборка за собой: тестовая заявка не должна оставаться в инбоксе УК
    if (ticketId) await dispatcher.delete(`/tickets/${ticketId}`);
  });

  it('диспетчер получает уведомление о новой заявке', async () => {
    const response = await dispatcher.get<NotificationsPayload>('/notifications?limit=10');
    expect(response.status).toBe(200);

    const toThisTicket = response.data?.items.filter((item) => item.entityId === ticketId) ?? [];
    expect(toThisTicket.length).toBeGreaterThan(0);
    expect(toThisTicket[0]?.type).toBe('ticket_created');
  });

  it('житель получает уведомление об ответе УК', async () => {
    const before = await resident.get<NotificationsPayload>('/notifications');
    const unreadBefore = before.data?.unread ?? 0;

    const comment = await dispatcher.post(`/tickets/${ticketId}/comments`, {
      body: 'Уточните, пожалуйста, удобное время для сантехника.',
    });
    expect(comment.status).toBe(201);

    const after = await resident.get<NotificationsPayload>('/notifications?limit=10');
    expect(after.data?.unread).toBe(unreadBefore + 1);
    expect(after.data?.items[0]?.type).toBe('ticket_comment');
    expect(after.data?.items[0]?.entityId).toBe(ticketId);
  });

  it('уведомление помечается прочитанным и чужое недоступно', async () => {
    const list = await resident.get<NotificationsPayload>('/notifications?limit=10');
    const unread = list.data?.items.find((item) => !item.readAt);
    expect(unread).toBeTruthy();

    const marked = await resident.post(`/notifications/${unread?.id}/read`, {});
    expect(marked.status).toBe(200);

    const afterRead = await resident.get<NotificationsPayload>('/notifications?limit=10');
    expect(afterRead.data?.items.find((item) => item.id === unread?.id)?.readAt).toBeTruthy();

    // Чужое уведомление неотличимо от несуществующего
    const foreign = await resident.post(`/notifications/00000000-0000-4000-8000-000000000000/read`, {});
    expect(foreign.status).toBe(404);
    expect(errorCode(foreign.data)).toBe('NOT_FOUND');
  });

  it('«прочитать все» обнуляет счётчик', async () => {
    const response = await resident.post('/notifications/read-all', {});
    expect(response.status).toBe(200);

    const list = await resident.get<NotificationsPayload>('/notifications');
    expect(list.data?.unread).toBe(0);
  });

  it('сигнал обновлений не показывает чужие заявки', async () => {
    const mine = await resident.get<UpdatesSnapshot>('/updates');
    const all = await dispatcher.get<UpdatesSnapshot>('/updates');

    expect(mine.status).toBe(200);
    expect(all.status).toBe(200);

    // У УК заявок в области видимости больше, чем у одного жителя
    expect((all.data?.tickets.count ?? 0)).toBeGreaterThan(mine.data?.tickets.count ?? 0);
    // Чужой отпечаток не раскрывает количество: житель видит только своё
    expect(mine.data?.tickets.count).toBeGreaterThan(0);
  });

  it('без авторизации уведомления и сигнал недоступны', async () => {
    const anonymous = new ApiClient();
    expect((await anonymous.get('/notifications')).status).toBe(401);
    expect((await anonymous.get('/updates')).status).toBe(401);
  });
});

describe('Заявка, созданная УК от имени жителя', () => {
  let admin: ApiClient;
  let resident: ApiClient;
  let ticketId = '';

  beforeAll(async () => {
    ({ client: admin } = await login({ identifier: '+79000000001', audience: 'staff' }));
    ({ client: resident } = await login({ identifier: RESIDENT }));
  });

  afterAll(async () => {
    if (ticketId) await admin.delete(`/tickets/${ticketId}`);
  });

  it('уведомляет подтверждённого жителя о создании, назначении и статусах', async () => {
    const bindings = await resident.get<{ items: { status: string; apartmentId: string }[] }>(
      '/resident/bindings',
    );
    const apartmentId = bindings.data?.items.find((item) => item.status === 'confirmed')?.apartmentId;
    expect(apartmentId).toBeTruthy();

    // Ищем дом, к которому относится квартира жителя
    const buildings = await admin.get<{ items: { id: string }[] }>('/buildings?limit=100');
    let buildingId = '';
    for (const building of buildings.data?.items ?? []) {
      const apartments = await admin.get<{ items: { id: string }[] }>(
        `/buildings/${building.id}/apartments?limit=100`,
      );
      if (apartments.data?.items.some((item) => item.id === apartmentId)) {
        buildingId = building.id;
        break;
      }
    }
    expect(buildingId).toBeTruthy();

    const categories = await admin.get<{ items: { id: string }[] }>('/ticket-categories');
    const categoryId = categories.data?.items[0]?.id;
    expect(categoryId).toBeTruthy();

    const staff = await admin.get<{ items: { id: string; roles: string[] }[] }>('/staff');
    const executor = staff.data?.items.find((item) => item.roles.includes('executor'));
    expect(executor).toBeTruthy();

    const created = await admin.post<{ id: string; number: number }>('/tickets', {
      buildingId,
      apartmentId,
      categoryId,
      priority: 'normal',
      source: 'dispatcher_walkin',
      title: 'Автотест: заявка от УК для жителя',
      description: 'Проверяем, что житель получает уведомления по заявке, созданной сотрудником.',
      contactPhone: RESIDENT,
    });
    expect(created.status).toBe(201);
    ticketId = created.data?.id ?? '';

    const assigned = await admin.post(`/tickets/${ticketId}/assign`, {
      assigneeId: executor?.id,
    });
    expect(assigned.status).toBe(200);

    const comment = await admin.post(`/tickets/${ticketId}/comments`, {
      body: 'Уточнение от УК по заявке жителя.',
    });
    expect(comment.status).toBe(201);

    expect((await admin.post(`/tickets/${ticketId}/status`, { to: 'in_progress' })).status).toBe(200);
    expect(
      (await admin.post(`/tickets/${ticketId}/status`, {
        to: 'done',
        comment: 'Работы выполнены в автотесте.',
      })).status,
    ).toBe(200);
    expect(
      (await admin.post(`/tickets/${ticketId}/close`, {
        resolutionNote: 'Закрыто в автотесте уведомлений.',
      })).status,
    ).toBe(200);

    const notifications = await resident.get<NotificationsPayload>('/notifications?limit=50');
    const toTicket = notifications.data?.items.filter((item) => item.entityId === ticketId) ?? [];

    expect(toTicket.some((item) => item.type === 'ticket_created')).toBe(true);
    expect(toTicket.some((item) => item.type === 'ticket_assigned')).toBe(true);
    expect(toTicket.some((item) => item.type === 'ticket_comment')).toBe(true);
    expect(toTicket.filter((item) => item.type === 'ticket_status_changed').length).toBeGreaterThan(0);
    expect(toTicket.some((item) => item.title.includes('Закрыта') || item.body?.includes('Закрыта'))).toBe(
      true,
    );
  });
});
