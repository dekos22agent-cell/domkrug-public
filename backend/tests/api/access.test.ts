/**
 * Доступ: точки, открытие, журнал, изоляция.
 *
 * Работает с mock-провайдером: команда не уходит на железо, но проверяются
 * именно те правила, которые важны на реальном доме — право на точку,
 * изоляция между УК, ограничение частоты и запись в журнал.
 */
import { describe, expect, it } from 'vitest';
import { ApiClient, login } from './helpers.js';

interface AccessPoint {
  id: string;
  kind: string;
  name: string;
  apartmentNumber: string;
  isActive: boolean;
}

interface AccessEvent {
  id: string;
  pointName: string;
  result: string;
  createdAt: string;
}

describe('Доступ', () => {
  it('житель видит только точки своих домов', async () => {
    const { client } = await login({ identifier: '+79000000101' });

    const response = await client.get<{ items: AccessPoint[] }>('/resident/access/points');
    expect(response.status).toBe(200);

    const points = response.data?.items ?? [];
    expect(points.length).toBeGreaterThan(0);

    // Точки не дублируются, даже если у жителя две квартиры
    const ids = points.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Шлагбаум и подъездная дверь должны быть в списке
    expect(points.some((item) => item.kind === 'barrier')).toBe(true);
    expect(points.some((item) => item.kind === 'entrance_door')).toBe(true);
  });

  it('открытие точки пишет событие в журнал', async () => {
    const { client } = await login({ identifier: '+79000000103' });

    const points = await client.get<{ items: AccessPoint[] }>('/resident/access/points');
    const door = points.data?.items.find((item) => item.kind === 'entrance_door');
    expect(door).toBeTruthy();

    const opened = await client.post<{ message: string }>(
      `/resident/access/points/${door?.id}/open`,
      {},
    );
    expect(opened.status).toBe(200);
    expect(opened.data?.message).toBeTruthy();

    const events = await client.get<{ items: AccessEvent[] }>('/resident/access/events?limit=5');
    expect(events.status).toBe(200);

    const latest = events.data?.items[0];
    expect(latest?.pointName).toBe(door?.name ?? latest?.pointName);
    expect(latest?.result).toBe('ok');
  });

  it('житель другой УК не может открыть чужую точку', async () => {
    // Иванов живёт в УК-1 и УК-2; берём его точку и пытаемся открыть
    // от имени жителя УК-2 из другого дома
    const { client: owner } = await login({ identifier: '+79000000101' });
    const points = await owner.get<{ items: AccessPoint[] }>('/resident/access/points');
    const foreignPoint = points.data?.items.find((item) => item.apartmentNumber === '1');
    expect(foreignPoint).toBeTruthy();

    const { client: stranger } = await login({ identifier: '+79000000201' });
    const attempt = await stranger.post(`/resident/access/points/${foreignPoint?.id}/open`, {});

    // Чужая точка неотличима от несуществующей
    expect(attempt.status).toBe(404);
  });

  it('несуществующая точка — 404', async () => {
    const { client } = await login({ identifier: '+79000000101' });
    const response = await client.post(
      '/resident/access/points/00000000-0000-4000-8000-000000000000/open',
      {},
    );
    expect(response.status).toBe(404);
  });

  it('частое нажатие ограничивается', async () => {
    // Отдельный житель, чтобы не мешать другим тестам счётчиком
    const { client } = await login({ identifier: '+79000000104' });

    const points = await client.get<{ items: AccessPoint[] }>('/resident/access/points');
    const point = points.data?.items[0];
    expect(point).toBeTruthy();

    // Окно лимита — минута, и оно переживает перезапуск тестов. Если
    // предыдущий прогон уже израсходовал квоту, проверять нечего: сразу
    // убеждаемся, что ограничение работает.
    const first = await client.post(`/resident/access/points/${point?.id}/open`, {});
    if (first.status === 429) {
      expect(first.status).toBe(429);
      return;
    }
    expect(first.status).toBe(200);

    // Лимит — 5 открытий в минуту: добираем остаток и ждём отказ
    let limitedStatus = 200;
    for (let attempt = 2; attempt <= 7; attempt += 1) {
      const response = await client.post(`/resident/access/points/${point?.id}/open`, {});
      limitedStatus = response.status;
      if (limitedStatus === 429) break;
      expect(limitedStatus).toBe(200);
    }
    expect(limitedStatus).toBe(429);
  });

  it('без авторизации точки недоступны', async () => {
    const anonymous = new ApiClient();
    const response = await anonymous.get('/resident/access/points');
    expect(response.status).toBe(401);
  });
});
