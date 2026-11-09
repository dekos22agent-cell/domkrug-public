/**
 * Доступ по коду: без регистрации и персональных данных.
 *
 * Проверяем то, ради чего это делалось: код даёт ровно выданные права,
 * не пускает в обычные разделы, перестаёт работать после отзыва и после
 * истечения срока.
 */
import { describe, expect, it } from 'vitest';
import { login } from './helpers.js';

interface IssuedCode {
  memberId: string;
  code: string;
  prefix: string;
}

interface GuestMe {
  guest: {
    memberId: string;
    label: string | null;
    addressText: string;
    apartmentNumber: string;
    scopes: string[];
    expiresAt: string | null;
  };
}

describe('Доступ по коду', () => {
  async function ownerApartment() {
    const { client } = await login({ identifier: '+79000000101' });
    const me = await client.get<{ bindings: { apartmentId: string; status: string }[] }>('/auth/me');
    const apartment = me.data?.bindings.find((item) => item.status === 'confirmed');
    return { client, apartmentId: apartment?.apartmentId ?? '' };
  }

  it('код открывает дверь без учётной записи', async () => {
    const { client: owner, apartmentId } = await ownerApartment();

    const issued = await owner.post<IssuedCode>('/resident/members/code', {
      apartmentId,
      preset: 'worker',
      label: 'Строитель Пётр',
      expiresAt: '2027-12-31',
    });
    expect(issued.status).toBe(201);
    expect(issued.data?.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // Вход по коду — без телефона, пароля и согласий
    const guest = await fetch('http://localhost:3000/api/v1/guest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ code: issued.data?.code }),
    });
    expect(guest.status).toBe(200);
    const body = (await guest.json()) as { token: string; guest: GuestMe['guest'] };
    expect(body.token).toBeTruthy();
    // Метка владельца гостю не показывается: он мог подписать доступ как угодно
    expect(body.guest.label ?? null).toBeNull();
    expect(body.guest.scopes).toEqual(['access.open']);

    // Гость видит точки и может открыть дверь
    const points = await fetch('http://localhost:3000/api/v1/guest/points', {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    const pointsBody = (await points.json()) as { items: { id: string }[] };
    expect(pointsBody.items.length).toBeGreaterThan(0);

    const opened = await fetch(
      `http://localhost:3000/api/v1/guest/points/${pointsBody.items[0]?.id}/open`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${body.token}`, 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    expect(opened.status).toBe(200);
  });

  it('открытие гостем видно жителю в журнале с меткой', async () => {
    const { client: owner } = await login({ identifier: '+79000000101' });
    const me = await owner.get<{ bindings: { apartmentId: string; status: string }[] }>('/auth/me');
    const apartment = me.data?.bindings.find((item) => item.status === 'confirmed');

    const issued = await owner.post<IssuedCode>('/resident/members/code', {
      apartmentId: apartment?.apartmentId,
      preset: 'guest',
      label: 'Строитель Пётр',
      expiresAt: '2027-12-31',
    });

    const loginResponse = await fetch('http://localhost:3000/api/v1/guest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: issued.data?.code }),
    });
    const { token } = (await loginResponse.json()) as { token: string };

    const points = await fetch('http://localhost:3000/api/v1/guest/points', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pointsBody = (await points.json()) as { items: { id: string }[] };
    await fetch(
      `http://localhost:3000/api/v1/guest/points/${pointsBody.items[0]?.id}/open`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      },
    );

    // Житель должен видеть открытие гостя: иначе «кто открыл дверь» не разобрать
    const events = await owner.get<{ items: { actor: string | null; result: string }[] }>(
      '/resident/access/events?limit=5',
    );
    expect(events.status).toBe(200);
    expect(
      (events.data?.items ?? []).some((item) => item.actor === 'Строитель Пётр'),
    ).toBe(true);
  });

  it('неверный код отклоняется одинаково с несуществующим', async () => {
    const response = await fetch('http://localhost:3000/api/v1/guest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ZZZZ-ZZZZ' }),
    });
    expect(response.status).toBe(401);
  });

  it('гостевой токен не пускает в разделы жителя', async () => {
    const { client: owner, apartmentId } = await ownerApartment();
    const issued = await owner.post<IssuedCode>('/resident/members/code', {
      apartmentId,
      preset: 'guest',
      label: 'Курьер',
      expiresAt: '2027-12-31',
    });

    const loginResponse = await fetch('http://localhost:3000/api/v1/guest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: issued.data?.code }),
    });
    const { token } = (await loginResponse.json()) as { token: string };

    // Профиль, заявки, счётчики — не для гостя
    for (const path of ['/auth/me', '/resident/tickets', '/resident/meters']) {
      const response = await fetch(`http://localhost:3000/api/v1${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(401);
    }
  });

  it('после отзыва кода доступ закрывается', async () => {
    const { client: owner, apartmentId } = await ownerApartment();
    const issued = await owner.post<IssuedCode>('/resident/members/code', {
      apartmentId,
      preset: 'guest',
      label: 'Гость до отзыва',
      expiresAt: '2027-12-31',
    });

    const loginResponse = await fetch('http://localhost:3000/api/v1/guest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: issued.data?.code }),
    });
    const { token } = (await loginResponse.json()) as { token: string };

    const revoked = await owner.delete(
      `/resident/members/${issued.data?.memberId}?apartmentId=${apartmentId}`,
    );
    expect(revoked.status).toBe(204);

    const after = await fetch('http://localhost:3000/api/v1/guest/points', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });

  it('для рабочего и гостя срок обязателен', async () => {
    const { client: owner, apartmentId } = await ownerApartment();

    const noExpiry = await owner.post('/resident/members/code', {
      apartmentId,
      preset: 'worker',
      label: 'Строитель без срока',
    });
    expect(noExpiry.status).toBe(400);
  });

  it('код с истёкшим сроком не работает', async () => {
    const { client: owner, apartmentId } = await ownerApartment();

    const issued = await owner.post<IssuedCode>('/resident/members/code', {
      apartmentId,
      preset: 'guest',
      label: 'Гость в прошлом',
      expiresAt: '2020-01-01',
    });
    expect(issued.status).toBe(201);

    const loginResponse = await fetch('http://localhost:3000/api/v1/guest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: issued.data?.code }),
    });
    expect(loginResponse.status).toBe(401);
  });
});
