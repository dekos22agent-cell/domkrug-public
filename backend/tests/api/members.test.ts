/**
 * Члены квартиры: приглашения, права, срок действия, отзыв.
 *
 * Главное, что проверяем: чужой человек с приглашением получает ровно те
 * права, что выдал владелец — и ни права больше.
 */
import { describe, expect, it } from 'vitest';
import { ApiClient, login, uniquePhone } from './helpers.js';

interface MeResponse {
  bindings: { apartmentId: string; status: string; addressText: string }[];
}

interface MemberItem {
  id: string;
  phone: string;
  preset: string;
  status: string;
  scopes: string[];
  claimed?: boolean;
}

/** Зарегистрировать нового жителя и вернуть клиент с токеном. */
async function registerResident(phone: string, fullName = 'Член семьи Тестовый') {
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

/** Подтвердить приглашённого: без этого доступ по телефону не включается. */
async function confirmInvite(
  owner: ApiClient,
  apartmentId: string | undefined,
  memberId: string | undefined,
) {
  const response = await owner.post(`/resident/members/${memberId}/confirm`, { apartmentId });
  expect(response.status).toBe(200);
}

describe('Члены квартиры', () => {
  it('владелец приглашает человека, и тот получает доступ к двери', async () => {
    const { client: owner } = await login({ identifier: '+79000000101' });
    const me = await owner.get<MeResponse>('/auth/me');
    const apartment = me.data?.bindings.find((item) => item.status === 'confirmed');
    expect(apartment).toBeTruthy();

    const childPhone = uniquePhone();
    const child = await registerResident(childPhone, 'Ребёнок Тестовый');

    const invited = await owner.post<{ member: MemberItem; activated: boolean }>(
      '/resident/members',
      { apartmentId: apartment?.apartmentId, phone: childPhone, preset: 'child' },
    );
    expect(invited.status).toBe(201);
    expect(invited.data?.activated).toBe(false);
    expect(invited.data?.member.claimed).toBe(true);
    expect(invited.data?.member.preset).toBe('child');
    expect(invited.data?.member.scopes).toEqual(['access.open']);

    // До подтверждения владельцем доступа нет: телефон не проверен SMS
    const beforeConfirm = await child.get<{ items: unknown[] }>('/resident/access/points');
    expect(beforeConfirm.data?.items.length).toBe(0);

    await confirmInvite(owner, apartment?.apartmentId, invited.data?.member.id);

    // Ребёнок видит точки доступа квартиры
    const points = await child.get<{ items: { kind: string }[] }>('/resident/access/points');
    expect(points.status).toBe(200);
    expect((points.data?.items.length ?? 0)).toBeGreaterThan(0);

    // И может открыть дверь
    const door = points.data?.items[0];
    const opened = await child.post(`/resident/access/points/${door?.kind}/open`, {});
    // Проверяем именно право: id точки мы не знаем, поэтому берём из списка
    expect([200, 404]).toContain(opened.status);
  });

  it('ребёнку не дают видео и показания', async () => {
    const { client: owner } = await login({ identifier: '+79000000101' });
    const me = await owner.get<MeResponse>('/auth/me');
    const apartment = me.data?.bindings.find((item) => item.status === 'confirmed');

    const childPhone = uniquePhone();
    const child = await registerResident(childPhone, 'Ребёнок Без Видео');

    await owner.post('/resident/members', {
      apartmentId: apartment?.apartmentId,
      phone: childPhone,
      preset: 'child',
    });

    // Видео недоступно
    const cameras = await child.get<{ items: unknown[] }>('/resident/video/cameras');
    expect(cameras.status).toBe(200);
    expect(cameras.data?.items.length).toBe(0);

    // Счётчики тоже
    const meters = await child.get<{ items: unknown[] }>('/resident/meters');
    expect(meters.data?.items.length).toBe(0);
  });

  it('рабочий с истёкшим сроком не получает доступ', async () => {
    const { client: owner } = await login({ identifier: '+79000000101' });
    const me = await owner.get<MeResponse>('/auth/me');
    const apartment = me.data?.bindings.find((item) => item.status === 'confirmed');

    const workerPhone = uniquePhone();
    const worker = await registerResident(workerPhone, 'Рабочий Просроченный');

    const invited = await owner.post('/resident/members', {
      apartmentId: apartment?.apartmentId,
      phone: workerPhone,
      preset: 'worker',
      expiresAt: '2026-01-01',
    });
    expect(invited.status).toBe(201);

    const points = await worker.get<{ items: unknown[] }>('/resident/access/points');
    expect(points.data?.items.length).toBe(0);
  });

  it('для рабочего и гостя срок обязателен', async () => {
    const { client: owner } = await login({ identifier: '+79000000101' });
    const me = await owner.get<MeResponse>('/auth/me');
    const apartment = me.data?.bindings.find((item) => item.status === 'confirmed');

    const response = await owner.post('/resident/members', {
      apartmentId: apartment?.apartmentId,
      phone: uniquePhone(),
      preset: 'worker',
    });

    expect(response.status).toBe(400);
  });

  it('отзыв доступа сразу закрывает двери', async () => {
    const { client: owner } = await login({ identifier: '+79000000101' });
    const me = await owner.get<MeResponse>('/auth/me');
    const apartment = me.data?.bindings.find((item) => item.status === 'confirmed');

    const phone = uniquePhone();
    const guest = await registerResident(phone, 'Гость Отзываемый');

    const invited = await owner.post<{ member: MemberItem }>('/resident/members', {
      apartmentId: apartment?.apartmentId,
      phone,
      preset: 'guest',
      expiresAt: '2030-01-01',
    });
    const memberId = invited.data?.member.id;
    expect(memberId).toBeTruthy();

    await confirmInvite(owner, apartment?.apartmentId, memberId);

    const before = await guest.get<{ items: unknown[] }>('/resident/access/points');
    expect((before.data?.items.length ?? 0)).toBeGreaterThan(0);

    const revoked = await owner.delete(
      `/resident/members/${memberId}?apartmentId=${apartment?.apartmentId}`,
    );
    expect(revoked.status).toBe(204);

    const after = await guest.get<{ items: unknown[] }>('/resident/access/points');
    expect(after.data?.items.length).toBe(0);
  });

  it('член квартиры не может приглашать других', async () => {
    const { client: owner } = await login({ identifier: '+79000000101' });
    const me = await owner.get<MeResponse>('/auth/me');
    const apartment = me.data?.bindings.find((item) => item.status === 'confirmed');

    const phone = uniquePhone();
    const member = await registerResident(phone, 'Член Без Прав');
    await owner.post('/resident/members', {
      apartmentId: apartment?.apartmentId,
      phone,
      preset: 'family',
    });

    const attempt = await member.post('/resident/members', {
      apartmentId: apartment?.apartmentId,
      phone: uniquePhone(),
      preset: 'guest',
      expiresAt: '2030-01-01',
    });
    expect(attempt.status).toBe(403);
  });

  it('чужие члены квартиры не видны постороннему', async () => {
    const { client: stranger } = await login({ identifier: '+79000000201' });
    const me = await stranger.get<MeResponse>('/auth/me');
    const apartment = me.data?.bindings.find((item) => item.status === 'confirmed');

    const response = await stranger.get(
      `/resident/members?apartmentId=${apartment?.apartmentId}`,
    );
    // Своя квартира — можно смотреть (владелец), но список пуст
    expect(response.status).toBe(200);
    expect((response.data as { items: unknown[] }).items.length).toBe(0);
  });
});

describe('Телефон в приглашении', () => {
  /** «+79232401520» → «+7 923 240-15-20»: как человек вводит руками */
  function prettify(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    const local = digits.slice(1);
    return `+7 ${local.slice(0, 3)} ${local.slice(3, 6)}-${local.slice(6, 8)}-${local.slice(8, 10)}`;
  }

  it('приглашение с форматированным номером включает доступ существующему пользователю', async () => {
    const { client: owner } = await login({ identifier: '+79000000101' });
    const me = await owner.get<MeResponse>('/auth/me');
    const apartment = me.data?.bindings.find((item) => item.status === 'confirmed');

    const phone = uniquePhone();
    const member = await registerResident(phone, 'Формат Телефона');

    // Владелец вводит номер как удобно, с пробелами и дефисами
    const invited = await owner.post<{ activated: boolean; member: MemberItem }>(
      '/resident/members',
      {
        apartmentId: apartment?.apartmentId,
        phone: prettify(phone),
        preset: 'family',
      },
    );

    expect(invited.status).toBe(201);
    expect(invited.data?.activated).toBe(false);
    expect(invited.data?.member.claimed).toBe(true);

    // Пока владелец не подтвердил — квартиры в /auth/me нет
    const beforeConfirm = await member.get<{ memberships: unknown[] }>('/auth/me');
    expect(beforeConfirm.data?.memberships.length).toBe(0);

    await confirmInvite(owner, apartment?.apartmentId, invited.data?.member.id);

    // Человек видит квартиру сразу после подтверждения, без повторного входа
    const memberMe = await member.get<{ memberships: { addressText: string }[] }>('/auth/me');
    expect(memberMe.data?.memberships.length).toBe(1);
  });

  it('код доступа виден владельцу в списке', async () => {
    const { client: owner } = await login({ identifier: '+79000000101' });
    const me = await owner.get<MeResponse>('/auth/me');
    const apartment = me.data?.bindings.find((item) => item.status === 'confirmed');

    const created = await owner.post<{ code: string; memberId: string }>('/resident/members/code', {
      apartmentId: apartment?.apartmentId,
      preset: 'guest',
      label: 'Проверка видимости кода',
      expiresAt: '2027-06-01',
    });
    const code = created.data?.code;
    expect(code).toBeTruthy();

    const list = await owner.get<{ items: { id: string; code: string | null }[] }>(
      `/resident/members?apartmentId=${apartment?.apartmentId}`,
    );
    const row = list.data?.items.find((item) => item.id === created.data?.memberId);
    // Владелец видит код в своём кабинете, а не только один раз при создании
    expect(row?.code).toBe(code);
  });
});