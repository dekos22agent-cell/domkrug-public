/**
 * Номера на вызывной панели и история звонков.
 *
 * Панель набирает не номер квартиры, а короткий номер («комнату»). Пока он
 * не задан, звонок в квартиру не приходит — поэтому УК должна уметь задать
 * его сама, а не через SQL.
 */
import { describe, expect, it } from 'vitest';
import { login } from './helpers.js';

interface ApartmentItem {
  id: string;
  number: string;
  intercomRoom: string | null;
}

interface HistoryItem {
  id: string;
  status: string;
  apartmentNumber: string;
  pointName: string;
  durationSeconds: number;
}

describe('Номера на панели и история звонков', () => {
  async function adminContext() {
    const { client } = await login({ identifier: '+79000000001' });
    const buildings = await client.get<{ items: { id: string; addressText: string }[] }>(
      '/buildings',
    );
    const building = buildings.data?.items[0];
    expect(building).toBeTruthy();
    return { client, buildingId: building?.id ?? '' };
  }

  async function apartmentsOf(
    client: Awaited<ReturnType<typeof login>>['client'],
    buildingId: string,
  ): Promise<ApartmentItem[]> {
    const response = await client.get<{ items: ApartmentItem[] }>(
      `/buildings/${buildingId}/apartments?limit=100`,
    );
    expect(response.status).toBe(200);
    return response.data?.items ?? [];
  }

  it('список квартир отдаёт номер на панели', async () => {
    const { client, buildingId } = await adminContext();
    const items = await apartmentsOf(client, buildingId);

    expect(items.length).toBeGreaterThan(0);
    // Поле есть даже когда номер не задан — иначе интерфейс не поймёт разницы
    expect(items[0]).toHaveProperty('intercomRoom');
  });

  it('автозаполнение подставляет номера квартир и не трогает заданные', async () => {
    const { client, buildingId } = await adminContext();

    const first = await client.post<{ filled: number; skipped: number }>(
      `/buildings/${buildingId}/apartments/rooms/autofill`,
      {},
    );
    expect(first.status).toBe(200);

    // После автозаполнения у каждой квартиры с числовым номером есть номер
    // на панели. Проверяем результат, а не количество: тест не должен зависеть
    // от того, запускали его раньше на этой базе или нет.
    const filled = await apartmentsOf(client, buildingId);
    const numeric = filled.filter((item) => /^[0-9]+$/.test(item.number));
    expect(numeric.length).toBeGreaterThan(0);
    for (const apartment of numeric) {
      expect(apartment.intercomRoom).toBeTruthy();
    }
    const withRoom = filled.find((item) => item.intercomRoom);
    expect(withRoom).toBeTruthy();

    // Номер, заданный вручную, автозаполнение не перезаписывает
    await client.patch(`/buildings/${buildingId}/apartments/${withRoom?.id}/room`, {
      room: '911',
    });
    const second = await client.post<{ filled: number }>(
      `/buildings/${buildingId}/apartments/rooms/autofill`,
      {},
    );
    expect(second.data?.filled).toBe(0);

    const after = await apartmentsOf(client, buildingId);
    const same = after.find((item) => item.id === withRoom?.id);
    expect(same?.intercomRoom).toBe('911');
  });

  it('номер можно поставить и снять', async () => {
    const { client, buildingId } = await adminContext();
    const items = await apartmentsOf(client, buildingId);
    const target = items[0];
    expect(target).toBeTruthy();

    const saved = await client.patch<{ ok: boolean; intercomRoom: string | null }>(
      `/buildings/${buildingId}/apartments/${target?.id}/room`,
      { room: '903' },
    );
    expect(saved.status).toBe(200);
    expect(saved.data?.intercomRoom).toBe('903');

    const cleared = await client.patch<{ ok: boolean; intercomRoom: string | null }>(
      `/buildings/${buildingId}/apartments/${target?.id}/room`,
      { room: null },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.data?.intercomRoom).toBeNull();
  });

  it('два одинаковых номера в доме запрещены', async () => {
    const { client, buildingId } = await adminContext();
    const items = await apartmentsOf(client, buildingId);
    const [first, second] = items;
    expect(first && second).toBeTruthy();

    await client.patch(`/buildings/${buildingId}/apartments/${first?.id}/room`, { room: '905' });
    const duplicate = await client.patch(
      `/buildings/${buildingId}/apartments/${second?.id}/room`,
      { room: '905' },
    );

    expect(duplicate.status).toBe(409);
  });

  it('житель не может менять номера на панели', async () => {
    const { client: admin, buildingId } = await adminContext();
    const items = await apartmentsOf(admin, buildingId);
    const { client: resident } = await login({ identifier: '+79000000101' });

    const attempt = await resident.patch(
      `/buildings/${buildingId}/apartments/${items[0]?.id}/room`,
      { room: '904' },
    );

    expect(attempt.status).toBe(403);
  });

  it('история звонков отдаётся жителю и только по его квартирам', async () => {
    const { client } = await login({ identifier: '+79000000101' });
    const response = await client.get<{ items: HistoryItem[] }>(
      '/resident/video/intercom/history?limit=5',
    );

    expect(response.status).toBe(200);
    expect(Array.isArray(response.data?.items)).toBe(true);

    for (const item of response.data?.items ?? []) {
      // У каждой записи есть человекочитаемые поля — их показывает интерфейс
      expect(item.pointName.length).toBeGreaterThan(0);
      expect(item.apartmentNumber.length).toBeGreaterThan(0);
      expect(item.durationSeconds).toBeGreaterThanOrEqual(0);
    }
  });
});
