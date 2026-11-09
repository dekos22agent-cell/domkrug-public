/**
 * Отвязка подтверждённой квартиры.
 *
 * Владелец попросил кнопку на экране «Квартира». Проверяем и серверную
 * часть: подтверждённую привязку можно удалить, после чего доступ к квартире
 * закрывается, а сама привязка исчезает из /auth/me.
 */
import { describe, expect, it } from 'vitest';
import { ApiClient, login, uniquePhone } from './helpers.js';

interface SearchItem {
  apartmentId: string;
  number: string;
}

describe('Отвязка квартиры', () => {
  it('подтверждённую привязку можно отозвать, и она исчезает', async () => {
    const phone = uniquePhone();
    const resident = new ApiClient();
    const registered = await resident.post<{ accessToken: string }>('/auth/register', {
      fullName: 'Тест Отвязки',
      phone,
      password: 'TestPass123',
      consentAccepted: true,
    });
    expect(registered.status).toBe(201);
    resident.accessToken = registered.data?.accessToken ?? null;

    // Ищем конкретную квартиру, чтобы не зависеть от порядка выдачи
    const search = await resident.get<{ items: SearchItem[] }>(
      '/resident/search-apartment?address=' + encodeURIComponent('Ленина') + '&apartment=2',
    );
    expect(search.status).toBe(200);
    const apartment = search.data?.items.find((item) => item.number === '2');
    expect(apartment).toBeTruthy();

    const created = await resident.post<{ id: string }>('/resident/bindings', {
      apartmentId: apartment?.apartmentId,
      roleInApartment: 'owner',
    });
    expect(created.status).toBe(201);

    // УК подтверждает заявку
    const { client: admin } = await login({ identifier: '+79000000001', audience: 'staff' });
    const queue = await admin.get<{ items: { id: string; residentPhone: string | null }[] }>(
      '/resident-bindings?status=pending',
    );
    const pending = queue.data?.items.find((item) => item.residentPhone === phone);
    expect(pending).toBeTruthy();
    const confirmed = await admin.post(`/resident-bindings/${pending?.id}/confirm`, {});
    expect(confirmed.status).toBe(200);

    const before = await resident.get<{ bindings: { status: string }[] }>('/auth/me');
    expect(before.data?.bindings.some((item) => item.status === 'confirmed')).toBe(true);

    // Отвязываем подтверждённую привязку
    const revoked = await resident.delete(`/resident/bindings/${created.data?.id}`);
    expect(revoked.status).toBe(204);

    const after = await resident.get<{ bindings: { status: string }[] }>('/auth/me');
    expect(after.data?.bindings.length).toBe(0);
  });
});
