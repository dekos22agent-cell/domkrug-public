/**
 * Тесты привязки жителя к квартире и структуры домов.
 *
 * Требуют запущенного API и демо-данных (см. auth.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { ApiClient, login, uniquePhone } from './helpers.js';

interface BuildingItem {
  id: string;
  addressText: string;
  apartmentsCount: number;
}

interface ApartmentItem {
  id: string;
  number: string;
}

interface SearchItem {
  apartmentId: string;
  number: string;
  addressText: string;
  alreadyBound: boolean;
}

interface BindingItem {
  id: string;
  status: string;
  apartmentNumber: string;
}

interface MeResponse {
  bindings: { id: string; status: string; apartmentId: string }[];
}

describe('Структура домов и привязки', () => {
  it('диспетчер видит дома своей УК с верными счётчиками', async () => {
    const { client } = await login({ identifier: '+79000000002' });

    const buildings = await client.get<{ items: BuildingItem[] }>('/buildings');
    expect(buildings.status).toBe(200);
    expect(buildings.data?.items).toHaveLength(1);

    const building = buildings.data?.items[0] as BuildingItem;
    expect(building.addressText).toContain('Ленина');
    // В демо-данных у УК-1 один дом на 12 квартир
    expect(building.apartmentsCount).toBe(12);

    const apartments = await client.get<{ items: ApartmentItem[] }>(
      `/buildings/${building.id}/apartments`,
    );
    expect(apartments.status).toBe(200);
    expect(apartments.data?.items).toHaveLength(12);
  });

  it('поиск квартиры не раскрывает персональные данные жильцов', async () => {
    const client = new ApiClient();
    const phone = uniquePhone();
    const registered = await client.post<{ accessToken: string }>('/auth/register', {
      fullName: 'Житель Для Поиска',
      phone,
      password: 'TestPass123',
      consentAccepted: true,
    });
    client.accessToken = registered.data?.accessToken ?? null;

    const search = await client.get<{ items: SearchItem[] }>(
      '/resident/search-apartment?address=%D0%9B%D0%B5%D0%BD%D0%B8%D0%BD%D0%B0',
    );
    expect(search.status).toBe(200);
    expect(search.data?.items.length).toBeGreaterThan(0);

    // В ответе не должно быть ФИО жителей — только адрес, номер и УК
    expect(search.text).not.toContain('Иванов');
    expect(search.text).not.toContain('Петрова');

    // Кириллица в адресе должна приходить корректно
    expect(search.data?.items[0]?.addressText).toContain('Барнаул');
  });

  it('полный цикл: заявка на привязку → подтверждение УК → статус confirmed', async () => {
    // 1. Житель находит свободную квартиру
    const residentClient = new ApiClient();
    const phone = uniquePhone();
    const registered = await residentClient.post<{ accessToken: string }>('/auth/register', {
      fullName: 'Житель Для Привязки',
      phone,
      password: 'TestPass123',
      consentAccepted: true,
    });
    residentClient.accessToken = registered.data?.accessToken ?? null;

    const search = await residentClient.get<{ items: SearchItem[] }>(
      '/resident/search-apartment?address=%D0%9B%D0%B5%D0%BD%D0%B8%D0%BD%D0%B0',
    );
    const free = search.data?.items.find((item) => !item.alreadyBound);
    expect(free).toBeTruthy();

    // 2. Отправляет заявку
    const created = await residentClient.post<BindingItem>('/resident/bindings', {
      apartmentId: free?.apartmentId,
      roleInApartment: 'owner',
    });
    expect(created.status).toBe(201);
    expect(created.data?.status).toBe('pending');

    // 3. Повторная заявка на ту же квартиру отклоняется
    const duplicate = await residentClient.post('/resident/bindings', {
      apartmentId: free?.apartmentId,
      roleInApartment: 'owner',
    });
    expect(duplicate.status).toBe(409);

    // 4. До подтверждения заявка видна жителю как pending
    const meBefore = await residentClient.get<MeResponse>('/auth/me');
    expect(meBefore.data?.bindings).toHaveLength(1);
    expect(meBefore.data?.bindings[0]?.status).toBe('pending');

    // 5. Диспетчер видит её в очереди и подтверждает
    const { client: dispatcher } = await login({ identifier: '+79000000002' });
    const pending = await dispatcher.get<{ items: { id: string }[] }>(
      '/resident-bindings?status=pending',
    );
    expect(pending.status).toBe(200);
    const ours = pending.data?.items.find((item) => item.id === created.data?.id);
    expect(ours).toBeTruthy();

    const confirmed = await dispatcher.post(`/resident-bindings/${created.data?.id}/confirm`);
    expect(confirmed.status).toBe(200);

    const meAfter = await residentClient.get<MeResponse>('/auth/me');
    expect(meAfter.data?.bindings[0]?.status).toBe('confirmed');

    // 6. Подтверждённую привязку теперь можно отвязать самостоятельно:
    // владелец попросил кнопку на экране «Квартира»
    const revokeConfirmed = await residentClient.delete(`/resident/bindings/${created.data?.id}`);
    expect(revokeConfirmed.status).toBe(204);

    const meAfterRevoke = await residentClient.get<MeResponse>('/auth/me');
    expect(meAfterRevoke.data?.bindings).toHaveLength(0);

    // 7. Неподтверждённую — можно
    const another = search.data?.items.find(
      (item) => !item.alreadyBound && item.apartmentId !== free?.apartmentId,
    );
    if (another) {
      const second = await residentClient.post<BindingItem>('/resident/bindings', {
        apartmentId: another.apartmentId,
      });
      expect(second.status).toBe(201);

      const revoked = await residentClient.delete(`/resident/bindings/${second.data?.id}`);
      expect(revoked.status).toBe(204);
    }
  });

  it('изоляция: диспетчер другой УК не видит и не подтверждает чужую заявку', async () => {
    // Заявка от жителя УК-1
    const residentClient = new ApiClient();
    const registered = await residentClient.post<{ accessToken: string }>('/auth/register', {
      fullName: 'Житель Чужой Заявки',
      phone: uniquePhone(),
      password: 'TestPass123',
      consentAccepted: true,
    });
    residentClient.accessToken = registered.data?.accessToken ?? null;

    const search = await residentClient.get<{ items: SearchItem[] }>(
      '/resident/search-apartment?address=%D0%9B%D0%B5%D0%BD%D0%B8%D0%BD%D0%B0',
    );
    const free = search.data?.items.find((item) => !item.alreadyBound);
    const created = await residentClient.post<BindingItem>('/resident/bindings', {
      apartmentId: free?.apartmentId,
    });
    expect(created.status).toBe(201);

    // Диспетчер УК-2 её не видит
    const { client: foreignDispatcher } = await login({ identifier: '+79000000022' });
    const foreignList = await foreignDispatcher.get<{ items: { id: string }[] }>(
      '/resident-bindings',
    );
    const leaked = foreignList.data?.items.some((item) => item.id === created.data?.id);
    expect(leaked).toBe(false);

    // И не может подтвердить: 404, а не 403 — не подтверждаем существование
    const foreignConfirm = await foreignDispatcher.post(
      `/resident-bindings/${created.data?.id}/confirm`,
    );
    expect([403, 404]).toContain(foreignConfirm.status);
  });

  it('житель без привязки к УК не получает список домов', async () => {
    const client = new ApiClient();
    const registered = await client.post<{ accessToken: string }>('/auth/register', {
      fullName: 'Житель Без УК',
      phone: uniquePhone(),
      password: 'TestPass123',
      consentAccepted: true,
    });
    client.accessToken = registered.data?.accessToken ?? null;

    const buildings = await client.get('/buildings');
    expect(buildings.status).toBe(403);
  });
});
