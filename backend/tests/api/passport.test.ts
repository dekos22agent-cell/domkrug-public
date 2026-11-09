/**
 * Паспорт объекта: чтение, сохранение и изоляция прав.
 *
 * Это первый слой объектной модели, поэтому проверяем не только запись полей,
 * но и то, что житель не может менять паспорт, а валидация не пропускает
 * невозможный год постройки.
 */
import { describe, expect, it } from 'vitest';
import { ApiClient, login } from './helpers.js';

const ADMIN = '+79000000001';
const RESIDENT = '+79000000101';

interface Building {
  id: string;
  addressText: string;
  objectKind: string;
}

interface PassportResponse {
  building: Building & {
    yearBuilt: number | null;
    totalFloors: number | null;
    totalEntrances: number | null;
  };
  passport: {
    cadastralNumber: string | null;
    parkingSpots: number | null;
    energyClass: string | null;
    managementStart: string | null;
  } | null;
  stats: { unitsTotal: number; apartments: number; entrances: number };
}

const payload = {
  objectKind: 'apartment_building',
  yearBuilt: 2019,
  totalFloors: 8,
  totalEntrances: 2,
  cadastralNumber: '22:63:030101:9876',
  yearCommissioned: 2019,
  totalArea: 5432.1,
  livingArea: 4200,
  commercialArea: 300,
  landArea: 1800,
  parkingSpots: 24,
  elevatorsCount: 3,
  energyClass: 'B',
  managementStart: '2026-01-01',
  warrantyUntil: '2031-01-01',
  notes: 'Автотест паспорта объекта.',
};

describe('Паспорт объекта', () => {
  it('читает и сохраняет паспорт, не теряя состав объекта', async () => {
    const { client } = await login({ identifier: ADMIN });
    const buildings = await client.get<{ items: Building[] }>('/buildings');
    const building = buildings.data?.items[0];
    expect(building).toBeTruthy();

    const before = await client.get<PassportResponse>(`/buildings/${building?.id}/passport`);
    expect(before.status).toBe(200);
    expect(before.data?.stats.unitsTotal).toBeGreaterThan(0);

    const saved = await client.put<PassportResponse>(`/buildings/${building?.id}/passport`, payload);
    expect(saved.status).toBe(200);
    expect(saved.data?.passport?.cadastralNumber).toBe(payload.cadastralNumber);
    expect(saved.data?.passport?.parkingSpots).toBe(payload.parkingSpots);
    expect(saved.data?.passport?.energyClass).toBe(payload.energyClass);
    expect(saved.data?.building.yearBuilt).toBe(payload.yearBuilt);
    expect(saved.data?.building.objectKind).toBe('apartment_building');

    const after = await client.get<PassportResponse>(`/buildings/${building?.id}/passport`);
    expect(after.data?.passport?.managementStart).toBe(payload.managementStart);
    expect(after.data?.stats.apartments).toBeGreaterThan(0);
  });

  it('не пропускает невозможный год постройки', async () => {
    const { client } = await login({ identifier: ADMIN });
    const buildings = await client.get<{ items: Building[] }>('/buildings');
    const building = buildings.data?.items[0];
    expect(building).toBeTruthy();

    const response = await client.put(`/buildings/${building?.id}/passport`, {
      ...payload,
      yearBuilt: 1500,
    });
    expect(response.status).toBe(400);
  });

  it('житель не может менять паспорт', async () => {
    const { client: admin } = await login({ identifier: ADMIN });
    const buildings = await admin.get<{ items: Building[] }>('/buildings');
    const building = buildings.data?.items[0];
    expect(building).toBeTruthy();

    const { client: resident } = await login({ identifier: RESIDENT });
    const response = await resident.put(`/buildings/${building?.id}/passport`, payload);
    expect(response.status).toBe(403);
  });
});
