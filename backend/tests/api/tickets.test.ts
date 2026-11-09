/**
 * Сквозной сценарий заявок: житель → диспетчер → исполнитель → закрытие.
 *
 * Это главный тест продукта: если он проходит, основной бизнес-процесс работает.
 * Требует запущенного API и демо-данных (см. auth.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { ApiClient, errorCode, login, uniquePhone } from './helpers.js';

interface TicketCreated {
  id: string;
  number: number;
  status: { code: string; name: string };
  slaDueAt: string;
}

interface TicketDetail {
  id: string;
  number: number;
  status: { code: string; name: string };
  title: string | null;
  description: string;
  resolutionNote: string | null;
  assignedTo: { id: string; fullName: string } | null;
  parentTicket: { id: string; number: number } | null;
  comments: { body: string; isInternal: boolean }[];
}

interface MeResponse {
  bindings: { status: string; apartmentId: string }[];
}

describe('Заявки', () => {
  describe('основной сценарий', () => {
    it('проходит путь от создания до закрытия', async () => {
      // ─── Участники ───────────────────────────────────────────────────────
      const { client: resident } = await login({ identifier: '+79000000101' });
      const { client: dispatcher } = await login({ identifier: '+79000000002' });
      const { client: plumber } = await login({ identifier: '+79000000003' });

      const me = await resident.get<MeResponse>('/auth/me');
      const binding = me.data?.bindings.find((item) => item.status === 'confirmed');
      expect(binding).toBeTruthy();

      // ─── Справочники ─────────────────────────────────────────────────────
      const staff = await dispatcher.get<{ items: { id: string; fullName: string }[] }>('/staff');
      expect(staff.status).toBe(200);
      const plumberUser = staff.data?.items.find((item) => item.fullName.includes('сантехник'));
      expect(plumberUser).toBeTruthy();

      const categories = await resident.get<{ items: { id: string; code: string }[] }>(
        '/ticket-categories',
      );
      expect(categories.data?.items.length).toBeGreaterThanOrEqual(12);
      const plumbing = categories.data?.items.find((item) => item.code === 'plumbing');
      expect(plumbing).toBeTruthy();

      // ─── Житель создаёт заявку ───────────────────────────────────────────
      const created = await resident.post<TicketCreated>('/resident/tickets', {
        apartmentId: binding?.apartmentId,
        categoryId: plumbing?.id,
        priority: 'high',
        title: 'Течёт кран на кухне',
        description: 'Капает под мойкой, ведро уже полное',
        contactPhone: '+79000000101',
      });

      expect(created.status).toBe(201);
      const ticket = created.data as TicketCreated;
      expect(ticket.number).toBeGreaterThan(0);
      expect(ticket.status.code).toBe('new');
      expect(ticket.slaDueAt).toBeTruthy();

      // ─── Житель видит заявку ─────────────────────────────────────────────
      const myTickets = await resident.get<{ items: { id: string }[] }>('/resident/tickets');
      expect(myTickets.data?.items.some((item) => item.id === ticket.id)).toBe(true);

      const ownDetail = await resident.get<TicketDetail>(`/resident/tickets/${ticket.id}`);
      expect(ownDetail.status).toBe(200);
      expect(ownDetail.data?.number).toBe(ticket.number);

      // ─── Диспетчер видит её в инбоксе ────────────────────────────────────
      const inbox = await dispatcher.get<{ items: { id: string }[] }>('/tickets?status=new');
      expect(inbox.data?.items.some((item) => item.id === ticket.id)).toBe(true);

      // ─── Принять и назначить ─────────────────────────────────────────────
      const accepted = await dispatcher.post(`/tickets/${ticket.id}/accept`);
      expect(accepted.status).toBe(200);

      const assigned = await dispatcher.post(`/tickets/${ticket.id}/assign`, {
        assigneeId: plumberUser?.id,
      });
      expect(assigned.status).toBe(200);

      const afterAssign = await dispatcher.get<TicketDetail>(`/tickets/${ticket.id}`);
      expect(afterAssign.data?.status.code).toBe('assigned');

      // ─── Исполнитель видит только назначенные ему ────────────────────────
      const assignedList = await plumber.get<{ items: { id: string }[] }>('/tickets/assigned');
      expect(assignedList.data?.items.some((item) => item.id === ticket.id)).toBe(true);

      // Чужая заявка (№2 из демо-данных, назначена электрику) недоступна
      const closedList = await dispatcher.get<{ items: { id: string; number: number }[] }>(
        '/tickets?status=closed',
      );
      const foreign = closedList.data?.items.find((item) => item.number === 2);
      expect(foreign).toBeTruthy();
      const foreignOpen = await plumber.get(`/tickets/${foreign?.id}`);
      expect(foreignOpen.status).toBe(404);

      // ─── В работу ────────────────────────────────────────────────────────
      const inProgress = await plumber.post(`/tickets/${ticket.id}/status`, { to: 'in_progress' });
      expect(inProgress.status).toBe(200);

      // ─── Диспетчеру закрытие запрещено ───────────────────────────────────
      const dispatcherClose = await dispatcher.post(`/tickets/${ticket.id}/close`, {
        resolutionNote: 'Попытка диспетчера закрыть',
      });
      expect(dispatcherClose.status).toBe(403);

      // ─── Закрытие без описания работ отклоняется ─────────────────────────
      const emptyClose = await plumber.post(`/tickets/${ticket.id}/close`, {
        resolutionNote: '   ',
      });
      expect(emptyClose.status).toBe(400);

      // ─── Исполнитель закрывает ───────────────────────────────────────────
      const closed = await plumber.post(`/tickets/${ticket.id}/close`, {
        resolutionNote: 'Заменён картридж смесителя, течь устранена',
      });
      expect(closed.status).toBe(200);

      // ─── Житель видит результат ──────────────────────────────────────────
      const afterClose = await resident.get<TicketDetail>(`/resident/tickets/${ticket.id}`);
      expect(afterClose.data?.status.code).toBe('closed');
      expect(afterClose.data?.resolutionNote).toContain('картридж');

      // ─── Служебный комментарий не виден жителю ───────────────────────────
      const internal = await dispatcher.post(`/tickets/${ticket.id}/comments`, {
        body: 'Служебное: житель просил перезвонить после 18:00',
        isInternal: true,
      });
      expect(internal.status).toBe(201);

      const residentView = await resident.get<TicketDetail>(`/resident/tickets/${ticket.id}`);
      const leaked = residentView.data?.comments.some((c) => c.body.includes('Служебное'));
      expect(leaked).toBe(false);

      const staffView = await dispatcher.get<TicketDetail>(`/tickets/${ticket.id}`);
      const staffSees = staffView.data?.comments.some((c) => c.body.includes('Служебное'));
      expect(staffSees).toBe(true);

      // ─── История содержит все переходы ───────────────────────────────────
      const history = await dispatcher.get<{ items: { to: { code: string } }[] }>(
        `/tickets/${ticket.id}/history`,
      );
      expect(history.data?.items.length).toBeGreaterThanOrEqual(4);
      expect(history.data?.items.at(-1)?.to.code).toBe('closed');

      // ─── Повторное обращение ─────────────────────────────────────────────
      const repeat = await resident.post<TicketCreated>(
        `/resident/tickets/${ticket.id}/report-problem`,
        { description: 'Течь осталась, только медленнее — прошу проверить ещё раз' },
      );
      expect(repeat.status).toBe(201);

      const repeatDetail = await resident.get<TicketDetail>(
        `/resident/tickets/${(repeat.data as TicketCreated).id}`,
      );
      expect(repeatDetail.data?.parentTicket?.number).toBe(ticket.number);

      // Второе повторное обращение в те же сутки запрещено
      const repeatAgain = await resident.post(`/resident/tickets/${ticket.id}/report-problem`, {
        description: 'Ещё одно повторное обращение в тот же день',
      });
      expect(repeatAgain.status).toBe(429);
      expect(errorCode(repeatAgain.data)).toBe('REPEAT_TOO_SOON');
    });
  });

  describe('изоляция и права', () => {
    it('житель без подтверждённой привязки не может создать заявку', async () => {
      const mePending = await login({ identifier: '+79000000105' });
      const me = await mePending.client.get<MeResponse>('/auth/me');
      const pendingBinding = me.data?.bindings[0];
      expect(pendingBinding?.status).toBe('pending');

      const denied = await mePending.client.post('/resident/tickets', {
        apartmentId: pendingBinding?.apartmentId,
        categoryId: '00000000-0000-0000-0000-000000000000',
        description: 'Попытка создать заявку без подтверждения привязки',
        contactPhone: '+79000000105',
      });

      // Проверка привязки выполняется ДО обращения к категории — поэтому 403
      expect(denied.status).toBe(403);
      expect(errorCode(denied.data)).toBe('BINDING_NOT_CONFIRMED');
    });

    it('диспетчер другой УК не видит и не открывает чужую заявку', async () => {
      const { client: resident } = await login({ identifier: '+79000000101' });
      const me = await resident.get<MeResponse>('/auth/me');
      const binding = me.data?.bindings.find((item) => item.status === 'confirmed');

      const categories = await resident.get<{ items: { id: string; code: string }[] }>(
        '/ticket-categories',
      );
      const category = categories.data?.items[0];

      const created = await resident.post<TicketCreated>('/resident/tickets', {
        apartmentId: binding?.apartmentId,
        categoryId: category?.id,
        description: 'Заявка для проверки изоляции между УК',
        contactPhone: '+79000000101',
      });
      expect(created.status).toBe(201);

      const { client: foreignDispatcher } = await login({ identifier: '+79000000022' });

      const list = await foreignDispatcher.get<{ items: { id: string }[] }>('/tickets');
      expect(list.data?.items.some((item) => item.id === (created.data as TicketCreated).id)).toBe(
        false,
      );

      const open = await foreignDispatcher.get(`/tickets/${(created.data as TicketCreated).id}`);
      expect(open.status).toBe(404);
    });
  });

  describe('кодировка', () => {
    it('русский текст сохраняется и возвращается без потерь', async () => {
      const { client: resident } = await login({ identifier: '+79000000101' });
      const me = await resident.get<MeResponse>('/auth/me');
      const binding = me.data?.bindings.find((item) => item.status === 'confirmed');

      const categories = await resident.get<{ items: { id: string; code: string }[] }>(
        '/ticket-categories',
      );
      const category = categories.data?.items.find((item) => item.code === 'plumbing');

      // Строка со «сложными» символами: ё, кавычки-ёлочки, тире, номер, процент
      const title = 'Проверка кодировки: ёжик, «кавычки», тире — №42, 100%';
      const description =
        'Описание с кириллицей: Ёё Йй Щщ Ъъ Ыы Ьь Ээ Юю Яя. Спецсимволы: «» — … № 100%.';

      const created = await resident.post<TicketCreated>('/resident/tickets', {
        apartmentId: binding?.apartmentId,
        categoryId: category?.id,
        title,
        description,
        contactPhone: '+79000000101',
      });
      expect(created.status).toBe(201);

      // Читаем обратно как житель
      const detail = await resident.get<TicketDetail>(
        `/resident/tickets/${(created.data as TicketCreated).id}`,
      );
      expect(detail.data?.title).toBe(title);
      expect(detail.data?.description).toBe(description);

      // И как сотрудник — другой путь сериализации
      const { client: dispatcher } = await login({ identifier: '+79000000002' });
      const staffView = await dispatcher.get<TicketDetail>(
        `/tickets/${(created.data as TicketCreated).id}`,
      );
      expect(staffView.data?.title).toBe(title);
      expect(staffView.data?.description).toBe(description);
    });
  });

  describe('регистрация с кириллицей', () => {
    it('ФИО сохраняется и возвращается без потерь', async () => {
      const client = new ApiClient();
      const fullName = 'Кузнецов Пётр Ильич-Молодой';

      const registered = await client.post<{ accessToken: string }>('/auth/register', {
        fullName,
        phone: uniquePhone(),
        password: 'TestPass123',
        consentAccepted: true,
      });
      expect(registered.status).toBe(201);
      client.accessToken = registered.data?.accessToken ?? null;

      const me = await client.get<{ user: { fullName: string } }>('/auth/me');
      expect(me.data?.user.fullName).toBe(fullName);
    });
  });
  describe('удаление своей заявки', () => {
    it('житель удаляет свою заявку, она исчезает из списка и карточки', async () => {
      const { client: resident } = await login({ identifier: '+79000000101' });
      const me = await resident.get<MeResponse>('/auth/me');
      const binding = me.data?.bindings.find((item) => item.status === 'confirmed');
      expect(binding).toBeTruthy();

      const categories = await resident.get<{ items: { id: string; code: string }[] }>(
        '/ticket-categories',
      );
      const plumbing = categories.data?.items.find((item) => item.code === 'plumbing');

      const created = await resident.post<TicketCreated>('/resident/tickets', {
        apartmentId: binding?.apartmentId,
        categoryId: plumbing?.id,
        description: 'Заявка для проверки удаления',
        contactPhone: '+79000000101',
      });
      expect(created.status).toBe(201);
      const ticketId = created.data?.id;
      expect(ticketId).toBeTruthy();

      const removed = await resident.delete(`/resident/tickets/${ticketId}`);
      expect(removed.status).toBe(204);

      // Карточка больше не открывается
      const after = await resident.get(`/resident/tickets/${ticketId}`);
      expect(after.status).toBe(404);

      // И в списке её тоже нет
      const list = await resident.get<{ items: { id: string }[] }>('/resident/tickets?limit=50');
      expect(list.data?.items.some((item) => item.id === ticketId)).toBe(false);
    });

    it('чужую заявку удалить нельзя', async () => {
      const { client: resident } = await login({ identifier: '+79000000101' });
      const { client: other } = await login({ identifier: '+79000000105' });

      const me = await resident.get<MeResponse>('/auth/me');
      const binding = me.data?.bindings.find((item) => item.status === 'confirmed');
      const categories = await resident.get<{ items: { id: string; code: string }[] }>(
        '/ticket-categories',
      );
      const created = await resident.post<TicketCreated>('/resident/tickets', {
        apartmentId: binding?.apartmentId,
        categoryId: categories.data?.items[0]?.id,
        description: 'Чужую заявку удалить нельзя',
        contactPhone: '+79000000101',
      });

      // У второго жителя нет подтверждённой привязки — он не должен даже видеть заявку
      const attempt = await other.delete(`/resident/tickets/${created.data?.id}`);
      expect(attempt.status).toBe(404);

      // Заявка на месте
      const still = await resident.get(`/resident/tickets/${created.data?.id}`);
      expect(still.status).toBe(200);
    });
  });
});
