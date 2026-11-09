/**
 * Камеры и видеозвонки.
 *
 * Проверяем главное: житель видит только свои камеры, чужая камера неотличима
 * от несуществующей, а звонок с вызывной панели можно открыть и отклонить.
 * Сам поток в демо-режиме не отдаётся — это тоже проверяется.
 */
import { describe, expect, it } from 'vitest';
import { login } from './helpers.js';

interface Camera {
  id: string;
  kind: string;
  name: string;
  hasLiveStream: boolean;
}

interface CallInfo {
  id: string;
  pointName: string;
  cameraName: string | null;
  apartmentNumber: string;
  stream: { demo: boolean; type: string; url: string | null } | null;
}

describe('Видеонаблюдение', () => {
  it('житель видит камеры своих домов без дублей', async () => {
    const { client } = await login({ identifier: '+79000000101' });

    const response = await client.get<{ items: Camera[] }>('/resident/video/cameras');
    expect(response.status).toBe(200);

    const cameras = response.data?.items ?? [];
    expect(cameras.length).toBeGreaterThan(0);

    const ids = cameras.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Камера вызывной панели должна быть в списке
    expect(cameras.some((item) => item.kind === 'call_panel')).toBe(true);
  });

  it('поток в демо-режиме не отдаёт видео и честно об этом сообщает', async () => {
    const { client } = await login({ identifier: '+79000000101' });
    const cameras = await client.get<{ items: Camera[] }>('/resident/video/cameras');
    const camera = cameras.data?.items[0];

    const stream = await client.get<{ type: string; url: string | null; demo: boolean }>(
      `/resident/video/cameras/${camera?.id}/stream`,
    );

    expect(stream.status).toBe(200);
    expect(stream.data?.demo).toBe(true);
    expect(stream.data?.type).toBe('demo');
    // Демо-режим не должен возвращать ссылку, по которой можно что-то увидеть
    expect(stream.data?.url).toBeNull();
  });

  it('чужая камера неотличима от несуществующей', async () => {
    const { client: owner } = await login({ identifier: '+79000000101' });
    const cameras = await owner.get<{ items: Camera[] }>('/resident/video/cameras');
    // Берём обзорную камеру: она есть только в первом доме
    const foreignCamera = cameras.data?.items.find((item) => item.kind === 'overview');
    expect(foreignCamera).toBeTruthy();

    const { client: stranger } = await login({ identifier: '+79000000201' });
    const attempt = await stranger.get(`/resident/video/cameras/${foreignCamera?.id}/stream`);
    expect(attempt.status).toBe(404);
  });

  it('звонок с вызывной панели: открыть дверь', async () => {
    const { client } = await login({ identifier: '+79000000102' });

    const created = await client.post<{ call: CallInfo }>('/resident/video/intercom/demo-call', {});
    expect(created.status).toBe(201);
    expect(created.data?.call.cameraName).toBeTruthy();
    // Демо-поток: картинка показывается заглушкой, а не видео
    expect(created.data?.call.stream?.demo).toBe(true);

    const active = await client.get<{ call: CallInfo | null }>('/resident/video/intercom/active');
    expect(active.data?.call?.id).toBe(created.data?.call.id);

    const opened = await client.post(`/resident/video/intercom/${created.data?.call.id}/open`, {});
    expect(opened.status).toBe(200);

    // После открытия звонок больше не активен
    const after = await client.get<{ call: CallInfo | null }>('/resident/video/intercom/active');
    expect(after.data?.call).toBeNull();
  });

  it('звонок можно отклонить', async () => {
    const { client } = await login({ identifier: '+79000000103' });

    const created = await client.post<{ call: CallInfo }>('/resident/video/intercom/demo-call', {});
    expect(created.status).toBe(201);

    const declined = await client.post(
      `/resident/video/intercom/${created.data?.call.id}/decline`,
      {},
    );
    expect(declined.status).toBe(204);

    const after = await client.get<{ call: CallInfo | null }>('/resident/video/intercom/active');
    expect(after.data?.call).toBeNull();
  });

  it('без авторизации камеры недоступны', async () => {
    const { client } = await login({ identifier: '+79000000101' });
    // Убеждаемся, что маршрут закрыт: анонимный клиент не получает список
    const anonymous = await fetch('http://localhost:3000/api/v1/resident/video/cameras');
    expect(anonymous.status).toBe(401);
    expect(client).toBeTruthy();
  });
});
