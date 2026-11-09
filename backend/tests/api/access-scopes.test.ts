/**
 * Доступ на конкретные типы точек: подъезд, калитка, шлагбаум.
 *
 * Проверяем не только «видит только выбранное», но и обратное: чужой тип
 * точки не открывается, даже если угадать её id.
 */
import { describe, expect, it } from 'vitest';
import { ApiClient, login, uniquePhone } from './helpers.js';

interface Point {
  id: string;
  kind: string;
  apartmentId: string;
}

async function registerResident(phone: string, fullName = 'Тест Типа Доступа') {
  const client = new ApiClient();
  const response = await client.post<{ accessToken: string }>('/auth/register', {
    fullName,
    phone,
    password: 'TestPass123',
    consentAccepted: true,
  });
  expect(response.status).toBe(201);
  client.accessToken = response.data?.accessToken ?? null;
  return client;
}

async function ownerPoints() {
  const { client } = await login({ identifier: '+79000000101' });
  const response = await client.get<{ items: Point[] }>('/resident/access/points');
  return { client, points: response.data?.items ?? [] };
}

/** Квартира, в которой есть все нужные типы точек (у владельца их может быть несколько). */
function apartmentWith(points: Point[], kinds: string[]) {
  const byApartment = new Map<string, Point[]>();
  for (const point of points) {
    const list = byApartment.get(point.apartmentId) ?? [];
    list.push(point);
    byApartment.set(point.apartmentId, list);
  }
  for (const [apartmentId, list] of byApartment) {
    if (kinds.every((kind) => list.some((point) => point.kind === kind))) {
      return { apartmentId, list };
    }
  }
  return null;
}

describe('Доступ по типам точек', () => {
  it('член квартиры получает только выбранный тип и не открывает чужой', async () => {
    const { client: owner, points } = await ownerPoints();
    const chosen = apartmentWith(points, ['entrance_door', 'wicket']);
    expect(chosen).toBeTruthy();
    if (!chosen) return;

    const entrance = chosen.list.find((item) => item.kind === 'entrance_door');
    const wicket = chosen.list.find((item) => item.kind === 'wicket');
    expect(entrance).toBeTruthy();
    expect(wicket).toBeTruthy();

    const phone = uniquePhone();
    const member = await registerResident(phone);

    const invited = await owner.post<{ member: { id: string; scopes: string[] } }>(
      '/resident/members',
      {
        apartmentId: chosen.apartmentId,
        phone,
        preset: 'family',
        scopes: ['access.wicket'],
      },
    );
    expect(invited.status).toBe(201);
    expect(invited.data?.member.scopes).toEqual(['access.wicket']);

    // Подтверждаем приглашённого: без этого доступ по телефону не активен
    const confirmed = await owner.post(
      `/resident/members/${invited.data?.member.id}/confirm`,
      { apartmentId: chosen.apartmentId },
    );
    expect(confirmed.status).toBe(200);

    const visible = await member.get<{ items: Point[] }>('/resident/access/points');
    expect(visible.status).toBe(200);
    expect(visible.data?.items.length).toBe(1);
    expect(visible.data?.items[0]?.kind).toBe('wicket');

    // Подъезд не выдан — 404, как несуществующая точка
    const denied = await member.post(
      `/resident/access/points/${entrance?.id}/open`,
      { source: 'app' },
    );
    expect(denied.status).toBe(404);

    // Калитка выдана — открывается
    const allowed = await member.post(`/resident/access/points/${wicket?.id}/open`, { source: 'app' });
    expect(allowed.status).toBe(200);
  });

  it('код открывает только выбранный тип точки', async () => {
    const { client: owner, points } = await ownerPoints();
    const chosen = apartmentWith(points, ['entrance_door', 'barrier']);
    expect(chosen).toBeTruthy();
    if (!chosen) return;

    const entrance = chosen.list.find((item) => item.kind === 'entrance_door');
    const barrier = chosen.list.find((item) => item.kind === 'barrier');
    expect(entrance).toBeTruthy();
    expect(barrier).toBeTruthy();

    const created = await owner.post<{ code: string }>('/resident/members/code', {
      apartmentId: chosen.apartmentId,
      preset: 'family',
      scopes: ['access.barrier'],
      label: 'Тест шлагбаума',
    });
    expect(created.status).toBe(201);
    const code = created.data?.code ?? '';

    const guest = new ApiClient();
    const signed = await guest.post<{ token: string }>('/guest/login', { code });
    expect(signed.status).toBe(200);
    guest.accessToken = signed.data?.token ?? null;

    const visible = await guest.get<{ items: Point[] }>('/guest/points');
    expect(visible.status).toBe(200);
    expect(visible.data?.items.length).toBe(1);
    expect(visible.data?.items[0]?.kind).toBe('barrier');

    const denied = await guest.post(`/guest/points/${entrance?.id}/open`, {});
    expect(denied.status).toBe(404);

    const allowed = await guest.post(`/guest/points/${barrier?.id}/open`, {});
    expect(allowed.status).toBe(200);
  });
});
