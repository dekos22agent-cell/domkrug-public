/**
 * Помещения и счётчики: типы, площадь, управление приборами.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { ApiClient, login } from './helpers.js';

const ADMIN = '+79000000001';
const RESIDENT = '+79000000101';

interface Building { id: string }
interface Apartment {
  id: string;
  number: string;
  kind: string;
  rooms: number | null;
  areaTotal: string | null;
  status: 'active' | 'archived';
}
interface Meter {
  id: string;
  kind: string;
  isActive: boolean;
  verificationDue: string | null;
  lastValue: number | null;
}

describe('Помещения и счётчики', () => {
  let admin: ApiClient;
  let building: Building;
  let apartment: Apartment;
  let meterId = '';

  afterAll(async () => {
    if (meterId) {
      await admin.delete(`/buildings/${building.id}/meters/${meterId}`);
    }
  });

  it('меняет тип, комнатность и площадь помещения', async () => {
    ({ client: admin } = await login({ identifier: ADMIN }));
    const buildings = await admin.get<{ items: Building[] }>('/buildings');
    building = buildings.data?.items[0] as Building;
    const apartments = await admin.get<{ items: Apartment[] }>(
      `/buildings/${building.id}/apartments?limit=100`,
    );
    apartment = apartments.data?.items[0] as Apartment;

    const response = await admin.patch(`/buildings/${building.id}/apartments/${apartment.id}`, {
      kind: 'office',
      rooms: 3,
      areaTotal: 77.7,
      status: 'active',
    });
    expect(response.status).toBe(200);

    const after = await admin.get<{ items: Apartment[] }>(
      `/buildings/${building.id}/apartments?limit=100`,
    );
    const updated = after.data?.items.find((item) => item.id === apartment.id);
    expect(updated?.kind).toBe('office');
    expect(updated?.rooms).toBe(3);
    expect(Number(updated?.areaTotal)).toBe(77.7);

    // Возвращаем демо-квартиру в исходный вид
    await admin.patch(`/buildings/${building.id}/apartments/${apartment.id}`, {
      kind: 'apartment',
      rooms: apartment.rooms,
      areaTotal: apartment.areaTotal ? Number(apartment.areaTotal) : null,
      status: apartment.status,
    });
  });

  it('создаёт, меняет и отключает счётчик', async () => {
    const created = await admin.post<Meter>(
      `/buildings/${building.id}/apartments/${apartment.id}/meters`,
      {
        kind: 'cold_water',
        serial: 'AUTOTEST-METER',
        unit: 'м³',
        verificationDue: '2030-01-01',
        isActive: true,
        initialValue: 10.5,
      },
    );
    expect(created.status).toBe(201);
    expect(created.data?.kind).toBe('cold_water');
    expect(created.data?.lastValue).toBe(10.5);
    meterId = created.data?.id ?? '';

    const updated = await admin.patch<Meter>(`/buildings/${building.id}/meters/${meterId}`, {
      kind: 'cold_water',
      serial: 'AUTOTEST-METER',
      unit: 'м³',
      verificationDue: '2031-01-01',
      isActive: true,
    });
    expect(updated.status).toBe(200);
    expect(updated.data?.verificationDue).toBe('2031-01-01');

    const removed = await admin.delete(`/buildings/${building.id}/meters/${meterId}`);
    expect(removed.status).toBe(204);
    meterId = '';
  });

  it('пропускает дубли при импорте и не даёт жителю менять помещения', async () => {
    const imported = await admin.post<{ created: number; skipped: number }>(
      `/buildings/${building.id}/apartments/import`,
      {
        rows: [{
          number: apartment.number,
          kind: 'apartment',
          rooms: apartment.rooms,
          areaTotal: apartment.areaTotal ? Number(apartment.areaTotal) : null,
        }],
      },
    );
    expect(imported.status).toBe(201);
    expect(imported.data?.skipped).toBe(1);

    const { client: resident } = await login({ identifier: RESIDENT });
    const denied = await resident.patch(`/buildings/${building.id}/apartments/${apartment.id}`, {
      kind: 'office',
      rooms: 1,
      areaTotal: 30,
      status: 'active',
    });
    expect(denied.status).toBe(403);
  });
});
