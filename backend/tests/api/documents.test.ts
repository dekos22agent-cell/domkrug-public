/**
 * Документы УК: публикация ссылки и лента жителя.
 */
import { describe, expect, it } from 'vitest';
import { ApiClient, login } from './helpers.js';

const ADMIN = '+79000000001';
const RESIDENT = '+79000000101';

interface DocumentItem {
  id: string;
  title: string;
  publishedAt: string | null;
}

describe('Документы УК', () => {
  it('публикует документ и показывает его жителю', async () => {
    const { client: admin } = await login({ identifier: ADMIN });
    const created = await admin.post<DocumentItem>('/documents', {
      title: 'Автотест: документ дома',
      description: 'Проверяем реестр документов.',
      category: 'house',
      url: 'https://liviti.ru/docs/autotest.pdf',
      buildingId: null,
      publish: true,
    });
    expect(created.status).toBe(201);
    expect(created.data?.publishedAt).toBeTruthy();

    const { client: resident } = await login({ identifier: RESIDENT });
    const list = await resident.get<{ items: DocumentItem[] }>('/resident/documents');
    expect(list.status).toBe(200);
    expect(list.data?.items.some((item) => item.id === created.data?.id)).toBe(true);
  });
});
