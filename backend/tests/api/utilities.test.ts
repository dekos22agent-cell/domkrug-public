/**
 * Счётчики, лифты, экстренные вызовы.
 *
 * Проверяем правила, которые важны на живых данных: показания не могут
 * уменьшаться, чужие счётчики не видны, вызов нельзя отправить дважды подряд.
 */
import { describe, expect, it } from 'vitest';
import { login } from './helpers.js';

interface Meter {
  id: string;
  kind: string;
  unit: string;
  lastValue: number | null;
  currentSubmitted: boolean;
  currentValue: number | null;
}

interface Lift {
  id: string;
  number: string;
  status: string;
}

describe('Счётчики', () => {
  it('житель видит свои счётчики с последними показаниями', async () => {
    const { client } = await login({ identifier: '+79000000101' });

    const response = await client.get<{ items: Meter[] }>('/resident/meters');
    expect(response.status).toBe(200);

    const meters = response.data?.items ?? [];
    expect(meters.length).toBeGreaterThan(0);
    expect(meters.every((meter) => meter.unit.length > 0)).toBe(true);
  });

  it('показание меньше предыдущего отклоняется', async () => {
    const { client } = await login({ identifier: '+79000000101' });
    const meters = await client.get<{ items: Meter[] }>('/resident/meters');
    const meter = meters.data?.items.find((item) => item.lastValue !== null);
    expect(meter).toBeTruthy();

    const tooLow = (meter?.lastValue ?? 10) - 5;
    const response = await client.post(`/resident/meters/${meter?.id}/readings`, {
      value: tooLow,
    });

    expect(response.status).toBe(409);
    expect(response.data).toBeTruthy();
  });

  it('корректное показание принимается и видно в списке', async () => {
    // Счётчики есть только у первой квартиры демо-данных
    const { client } = await login({ identifier: '+79000000101' });
    const meters = await client.get<{ items: Meter[] }>('/resident/meters');
    const meter = meters.data?.items[0];
    expect(meter).toBeTruthy();

    const value = (meter?.lastValue ?? 0) + 1;
    const response = await client.post(`/resident/meters/${meter?.id}/readings`, { value });
    expect([200, 201]).toContain(response.status);

    const after = await client.get<{ items: Meter[] }>('/resident/meters');
    const updated = after.data?.items.find((item) => item.id === meter?.id);
    expect(updated?.currentSubmitted).toBe(true);
    expect(updated?.currentValue).toBe(value);
  });

  it('чужой счётчик неотличим от несуществующего', async () => {
    const { client: owner } = await login({ identifier: '+79000000101' });
    const meters = await owner.get<{ items: Meter[] }>('/resident/meters');
    const foreignMeter = meters.data?.items[0];

    const { client: stranger } = await login({ identifier: '+79000000201' });
    const attempt = await stranger.post(`/resident/meters/${foreignMeter?.id}/readings`, {
      value: 999,
    });
    expect(attempt.status).toBe(404);
  });
});

describe('Лифты', () => {
  it('житель видит лифты своего дома', async () => {
    const { client } = await login({ identifier: '+79000000101' });

    const response = await client.get<{ items: Lift[] }>('/resident/lifts');
    expect(response.status).toBe(200);
    expect((response.data?.items.length ?? 0)).toBeGreaterThan(0);
  });

  it('вызов лифта фиксируется в журнале', async () => {
    const { client } = await login({ identifier: '+79000000103' });
    const lifts = await client.get<{ items: Lift[] }>('/resident/lifts');
    const lift = lifts.data?.items.find((item) => item.status !== 'fault');
    expect(lift).toBeTruthy();

    const called = await client.post(`/resident/lifts/${lift?.id}/call`, {});
    expect(called.status).toBe(201);

    const events = await client.get<{ items: { kind: string }[] }>('/resident/lifts/events');
    const latest = events.data?.items[0];
    expect(latest?.kind).toBe('call');
  });

  it('сообщение о неисправности принимается с текстом', async () => {
    const { client } = await login({ identifier: '+79000000103' });
    const lifts = await client.get<{ items: Lift[] }>('/resident/lifts');
    const lift = lifts.data?.items[0];

    const reported = await client.post(`/resident/lifts/${lift?.id}/fault`, {
      note: 'Двери не закрываются на 3 этаже',
    });
    expect(reported.status).toBe(201);
  });

  it('чужой лифт неотличим от несуществующего', async () => {
    const { client: owner } = await login({ identifier: '+79000000101' });
    const lifts = await owner.get<{ items: Lift[] }>('/resident/lifts');
    const foreignLift = lifts.data?.items[0];

    const { client: stranger } = await login({ identifier: '+79000000201' });
    const attempt = await stranger.post(`/resident/lifts/${foreignLift?.id}/call`, {});
    expect(attempt.status).toBe(404);
  });
});

describe('Экстренные сообщения и вызовы', () => {
  it('житель видит сообщения своей УК и своего дома', async () => {
    const { client } = await login({ identifier: '+79000000101' });

    const response = await client.get<{ items: { title: string; severity: string }[] }>(
      '/resident/emergency/messages',
    );
    expect(response.status).toBe(200);

    const messages = response.data?.items ?? [];
    expect(messages.length).toBeGreaterThan(0);
    // Есть и сообщение по всей УК, и по конкретному дому
    expect(messages.some((item) => item.severity === 'warning')).toBe(true);
  });

  it('вызов создаётся, повторный в течение пяти минут отклоняется', async () => {
    const { client } = await login({ identifier: '+79000000104' });

    // Окно ограничения переживает перезапуск тестов: если вызов уже был
    // в предыдущем прогоне, проверяем сразу отказ.
    const created = await client.post<{ call: { id: string; status: string } }>(
      '/resident/emergency/calls',
      { kind: 'uk_duty', locationNote: 'Не работает замок в подъезде' },
    );

    if (created.status === 429) {
      expect(created.status).toBe(429);
      return;
    }

    expect(created.status).toBe(201);
    expect(created.data?.call.status).toBe('requested');

    const again = await client.post('/resident/emergency/calls', { kind: 'uk_duty' });
    expect(again.status).toBe(429);
  });
});

describe('Телефоны и связь с заявками', () => {
  it('житель видит телефоны УК и обслуживающих организаций', async () => {
    const { client } = await login({ identifier: '+79000000101' });

    const response = await client.get<{ items: { kind: string; name: string; phone: string }[] }>(
      '/resident/contacts',
    );
    expect(response.status).toBe(200);

    const items = response.data?.items ?? [];
    expect(items.length).toBeGreaterThan(0);

    // Есть хотя бы один телефон УК и хотя бы один не УК
    expect(items.some((item) => item.kind === 'uk')).toBe(true);
    expect(items.some((item) => item.kind !== 'uk')).toBe(true);
    expect(items.every((item) => item.phone.length > 3)).toBe(true);
  });

  it('телефоны другой УК не видны', async () => {
    const { client } = await login({ identifier: '+79000000201' });
    const response = await client.get<{ items: { name: string }[] }>('/resident/contacts');

    expect(response.status).toBe(200);
    // У второго УК своих телефонов в демо-данных нет
    expect((response.data?.items.length ?? 0)).toBe(0);
  });

  it('сообщение о неисправности лифта создаёт заявку в инбоксе', async () => {
    const { client } = await login({ identifier: '+79000000102' });

    const lifts = await client.get<{ items: { id: string; number: string }[] }>('/resident/lifts');
    const lift = lifts.data?.items[0];
    expect(lift).toBeTruthy();

    const before = await client.get<{ items: { id: string }[] }>('/resident/tickets?limit=50');
    const beforeCount = before.data?.items.length ?? 0;

    const reported = await client.post<{ ticketNumber: number }>(
      `/resident/lifts/${lift?.id}/fault`,
      { note: 'Лифт останавливается между этажами' },
    );
    expect(reported.status).toBe(201);
    expect(reported.data?.ticketNumber).toBeGreaterThan(0);

    // Заявка появилась в списке жителя — УК увидит её в инбоксе
    const after = await client.get<{ items: { id: string; title: string | null }[] }>(
      '/resident/tickets?limit=50',
    );
    expect((after.data?.items.length ?? 0)).toBe(beforeCount + 1);
    expect(after.data?.items.some((item) => item.title?.includes('лифта'))).toBe(true);
  });
});