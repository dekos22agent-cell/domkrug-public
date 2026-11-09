/**
 * Объявления УК: публикация, лента жителя и уведомление.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { ApiClient, login } from './helpers.js';

const ADMIN = '+79000000001';
const RESIDENT = '+79000000101';

interface News {
  id: string;
  title: string;
  publishedAt: string | null;
}

describe('Объявления УК', () => {
  let admin: ApiClient;
  let newsId = '';

  afterAll(async () => {
    // Удаления через API нет: оставляем запись как демо-объявление.
    void newsId;
  });

  it('публикует объявление и показывает его жителю', async () => {
    ({ client: admin } = await login({ identifier: ADMIN }));
    const created = await admin.post<News>('/news', {
      title: 'Автотест: объявление для жителя',
      body: 'Проверяем публикацию объявления и уведомление жителя.',
      isEmergency: false,
      publish: true,
    });
    expect(created.status).toBe(201);
    expect(created.data?.publishedAt).toBeTruthy();
    newsId = created.data?.id ?? '';

    const { client: resident } = await login({ identifier: RESIDENT });
    const feed = await resident.get<{ items: News[] }>('/resident/news');
    expect(feed.status).toBe(200);
    expect(feed.data?.items.some((item) => item.id === newsId)).toBe(true);
  });
});
