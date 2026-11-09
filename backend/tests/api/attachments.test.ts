/**
 * Фотографии заявок: загрузка, чтение, чужие не видят.
 *
 * Файл — это данные, которые легко отдать не тому. Поэтому проверяем не только
 * «загрузилось», но и что чужой житель получает 404, а тип определяется
 * по содержимому, а не по расширению.
 */
import { describe, expect, it } from 'vitest';
import { login } from './helpers.js';

/** Крошечный валидный PNG 1×1 — достаточно, чтобы проверка по магии байтов прошла. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface AttachmentItem {
  id: string;
  kind: 'request_photo' | 'result_photo' | 'comment_file' | 'document';
  commentId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

interface TicketCreated {
  id: string;
  number: number;
}

async function createTicketForResident(phone: string): Promise<{ ticketId: string; token: string }> {
  const { client } = await login({ identifier: phone });
  const me = await client.get<{ bindings: { apartmentId: string; status: string }[] }>('/auth/me');
  const apartment = me.data?.bindings.find((item) => item.status === 'confirmed');
  const categories = await client.get<{ items: { id: string }[] }>('/ticket-categories');

  const created = await client.post<TicketCreated>('/resident/tickets', {
    apartmentId: apartment?.apartmentId,
    categoryId: categories.data?.items[0]?.id,
    priority: 'normal',
    description: 'Фотография к заявке: течёт кран на кухне, вода капает на пол',
    contactPhone: phone,
  });
  expect(created.status).toBe(201);

  return { ticketId: created.data?.id ?? '', token: client.accessToken ?? '' };
}

function photoForm(bytes: Buffer, name: string): FormData {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), name);
  return form;
}

function uploadPhoto(token: string, ticketId: string, bytes: Buffer, name: string) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), name);

  return fetch(`http://localhost:3000/api/v1/resident/tickets/${ticketId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

describe('Фото в заявках', () => {
  it('житель загружает фото и видит его в списке', async () => {
    const { ticketId, token } = await createTicketForResident('+79000000101');

    const response = await uploadPhoto(token, ticketId, PNG_BYTES, 'кран.png');
    expect(response.status).toBe(201);

    const uploaded = (await response.json()) as AttachmentItem;
    expect(uploaded.mimeType).toBe('image/png');
    expect(uploaded.sizeBytes).toBe(PNG_BYTES.length);

    const list = await fetch(
      `http://localhost:3000/api/v1/resident/tickets/${ticketId}/attachments`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: AttachmentItem[] };
    expect(body.items.some((item) => item.id === uploaded.id)).toBe(true);

    // Файл отдаётся потоком с правильным типом
    const file = await fetch(
      `http://localhost:3000/api/v1/resident/tickets/${ticketId}/attachments/${uploaded.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('image/png');
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(bytes.length).toBe(PNG_BYTES.length);
  });

  it('файл не-картинка отклоняется, даже если назван .png', async () => {
    const { ticketId, token } = await createTicketForResident('+79000000101');

    // Расширение «.png», содержимое — обычный текст
    const response = await uploadPhoto(token, ticketId, Buffer.from('не картинка'), 'photo.png');
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNSUPPORTED_MIME');
  });

  it('чужой житель не видит фото и не может его скачать', async () => {
    const { ticketId, token } = await createTicketForResident('+79000000101');
    const uploaded = (await (
      await uploadPhoto(token, ticketId, PNG_BYTES, 'кран.png')
    ).json()) as AttachmentItem;

    const stranger = await login({ identifier: '+79000000201' });

    const list = await stranger.client.get<{ items: AttachmentItem[] }>(
      `/resident/tickets/${ticketId}/attachments`,
    );
    expect(list.status).toBe(404);

    const file = await fetch(
      `http://localhost:3000/api/v1/resident/tickets/${ticketId}/attachments/${uploaded.id}`,
      { headers: { Authorization: `Bearer ${stranger.client.accessToken}` } },
    );
    expect(file.status).toBe(404);
  });

  it('сотрудник УК видит фото заявки', async () => {
    const { ticketId, token } = await createTicketForResident('+79000000101');
    const uploaded = (await (
      await uploadPhoto(token, ticketId, PNG_BYTES, 'кран.png')
    ).json()) as AttachmentItem;

    const { client: staff } = await login({ identifier: '+79000000002' });

    const file = await fetch(
      `http://localhost:3000/api/v1/tickets/${ticketId}/attachments/${uploaded.id}`,
      { headers: { Authorization: `Bearer ${staff.accessToken}` } },
    );
    expect(file.status).toBe(200);
  });

  it('исполнитель прикладывает фотоотчёт и фото к комментарию', async () => {
    const { ticketId } = await createTicketForResident('+79000000101');

    // Диспетчер назначает заявку исполнителю — до этого он её не видит
    const { client: dispatcher } = await login({ identifier: '+79000000002' });
    const staff = await dispatcher.get<{
      items: { id: string; fullName: string; roles: string[] }[];
    }>('/staff?limit=50');
    const plumber = staff.data?.items.find((item) => item.roles.includes('executor'));
    expect(plumber).toBeTruthy();
    await dispatcher.post(`/tickets/${ticketId}/assign`, { assigneeId: plumber?.id });

    const { client: executor } = await login({ identifier: '+79000000003' });

    // Фотоотчёт: kind=result_photo
    const report = await executor.postForm<AttachmentItem>(
      `/tickets/${ticketId}/attachments?kind=result_photo`,
      photoForm(PNG_BYTES, 'отчёт.png'),
    );
    expect(report.status).toBe(201);
    expect(report.data?.kind).toBe('result_photo');

    // Комментарий и фото к нему
    const comment = await executor.post<{ id: string }>(`/tickets/${ticketId}/comments`, {
      body: 'Заменил кран, прикладываю фото',
      isInternal: false,
    });
    expect(comment.status).toBe(201);

    const attached = await executor.postForm<AttachmentItem>(
      `/tickets/${ticketId}/attachments?kind=comment_file&commentId=${comment.data?.id}`,
      photoForm(PNG_BYTES, 'комментарий.png'),
    );
    expect(attached.status).toBe(201);
    expect(attached.data?.commentId).toBe(comment.data?.id);
  });

  it('фото нельзя приложить к комментарию чужой заявки', async () => {
    const first = await createTicketForResident('+79000000101');
    const second = await createTicketForResident('+79000000101');

    const comment = await fetch(
      `http://localhost:3000/api/v1/resident/tickets/${first.ticketId}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${first.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: 'Комментарий в первой заявке', isInternal: false }),
      },
    );
    const created = (await comment.json()) as { id: string };

    // Тот же человек, но комментарий относится к другой заявке — привязка запрещена
    const form = photoForm(PNG_BYTES, 'перенос.png');
    const response = await fetch(
      `http://localhost:3000/api/v1/resident/tickets/${second.ticketId}/attachments?kind=comment_file&commentId=${created.id}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${second.token}` },
        body: form,
      },
    );

    expect(response.status).toBe(400);
  });

  it('сотрудник УК видит фотографии в списке заявки', async () => {
    const { ticketId, token } = await createTicketForResident('+79000000101');
    const uploaded = (await (
      await uploadPhoto(token, ticketId, PNG_BYTES, 'кран.png')
    ).json()) as AttachmentItem;

    const { client: dispatcher } = await login({ identifier: '+79000000002' });
    const list = await dispatcher.get<{ items: AttachmentItem[] }>(
      `/tickets/${ticketId}/attachments`,
    );

    expect(list.status).toBe(200);
    expect(list.data?.items.some((item) => item.id === uploaded.id)).toBe(true);
  });

  it('сотрудник другой УК не видит фотографии', async () => {
    const { ticketId, token } = await createTicketForResident('+79000000101');
    await uploadPhoto(token, ticketId, PNG_BYTES, 'кран.png');

    const { client: alien } = await login({ identifier: '+79000000021' });
    const list = await alien.get<{ items: AttachmentItem[] }>(`/tickets/${ticketId}/attachments`);

    // Чужая заявка — 404, как несуществующая: подтверждать её наличие нельзя
    expect(list.status).toBe(404);
  });

  it('без авторизации файл не отдаётся', async () => {
    const { ticketId, token } = await createTicketForResident('+79000000101');
    const uploaded = (await (
      await uploadPhoto(token, ticketId, PNG_BYTES, 'кран.png')
    ).json()) as AttachmentItem;

    const response = await fetch(
      `http://localhost:3000/api/v1/resident/tickets/${ticketId}/attachments/${uploaded.id}`,
    );
    expect(response.status).toBe(401);
  });
});
