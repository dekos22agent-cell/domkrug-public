/**
 * Собственники: отдельный реестр физических лиц и прав на помещение.
 *
 * Проверяем создание, изменение, удаление и запрет жителю управлять реестром.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { ApiClient, login } from './helpers.js';

const ADMIN = '+79000000001';
const RESIDENT = '+79000000101';

interface Building {
  id: string;
  addressText: string;
}

interface Apartment {
  id: string;
  number: string;
}

interface OwnerItem {
  ownershipId: string;
  ownerId: string;
  fullName: string;
  role: string;
  sharePercent: string;
  apartmentId: string;
}

const payload = {
  fullName: 'Автотестов Собственник Иванович',
  phone: '+79005556677',
  email: 'owner-autotest@example.com',
  role: 'owner',
  sharePercent: 75,
  validFrom: '2026-02-01',
  validTo: null,
  notes: 'Автотест реестра собственников.',
};

describe('Собственники', () => {
  let admin: ApiClient;
  let building: Building;
  let apartment: Apartment;
  let ownershipId = '';

  afterAll(async () => {
    if (ownershipId) {
      await admin.delete(`/buildings/${building.id}/owners/${ownershipId}`);
    }
  });

  it('создаёт собственника, меняет долю и убирает из помещения', async () => {
    ({ client: admin } = await login({ identifier: ADMIN }));

    const buildings = await admin.get<{ items: Building[] }>('/buildings');
    building = buildings.data?.items[0] as Building;
    expect(building).toBeTruthy();

    const apartments = await admin.get<{ items: Apartment[] }>(
      `/buildings/${building.id}/apartments?limit=100`,
    );
    apartment = apartments.data?.items[0] as Apartment;
    expect(apartment).toBeTruthy();

    const created = await admin.post<OwnerItem>(
      `/buildings/${building.id}/apartments/${apartment.id}/owners`,
      payload,
    );
    expect(created.status).toBe(201);
    expect(created.data?.fullName).toBe(payload.fullName);
    expect(created.data?.sharePercent).toBe('75.00');
    ownershipId = created.data?.ownershipId ?? '';

    const list = await admin.get<{ items: OwnerItem[] }>(`/buildings/${building.id}/owners`);
    expect(list.data?.items.some((item) => item.ownershipId === ownershipId)).toBe(true);

    const updated = await admin.patch<OwnerItem>(
      `/buildings/${building.id}/owners/${ownershipId}`,
      {
        ...payload,
        role: 'representative',
        sharePercent: 25,
        validTo: '2028-02-01',
      },
    );
    expect(updated.status).toBe(200);
    expect(updated.data?.role).toBe('representative');
    expect(updated.data?.sharePercent).toBe('25.00');

    const removed = await admin.delete(`/buildings/${building.id}/owners/${ownershipId}`);
    expect(removed.status).toBe(204);
    ownershipId = '';

    const after = await admin.get<{ items: OwnerItem[] }>(`/buildings/${building.id}/owners`);
    expect(after.data?.items.some((item) => item.fullName === payload.fullName)).toBe(false);
  });

  it('житель не может управлять реестром собственников', async () => {
    const { client: resident } = await login({ identifier: RESIDENT });
    const response = await resident.post(
      `/buildings/${building.id}/apartments/${apartment.id}/owners`,
      payload,
    );
    expect(response.status).toBe(403);
  });
});
