/**
 * Маршруты заявок.
 *
 * Разделение:
 *   /resident/tickets  — житель: только свои заявки и свои квартиры;
 *   /tickets           — сотрудники УК: вся УК или только назначенные.
 *
 * Права проверяются guard-ом, принадлежность к УК — в запросах сервиса.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import {
  canResidentSeeTicket,
  canStaffSeeTicket,
  listAttachments,
  openAttachment,
  saveAttachment,
  type AttachmentKind,
} from './attachments.js';
import { query } from '../../db/pool.js';
import { clampLimit } from '../../lib/pagination.js';
import type { AuthContext } from '../../plugins/auth.js';
import { writeAudit } from '../auth/service.js';
import {
  addComment,
  canRepeatWithinDay,
  createTicket,
  getTicketBasicsForRepeat,
  getTicketForResident,
  getTicketForStaff,
  hasConfirmedBinding,
  listHistory,
  listResidentTickets,
  listTickets,
  maxPriority,
  transitionStatus,
  assignTicket,
  type ListFilters,
} from './service.js';

const phoneSchema = z
  .string()
  .regex(/^\+7\d{10}$/, 'Телефон в формате +7XXXXXXXXXX, например +79001234567');

const residentCreateSchema = z.object({
  apartmentId: z.string().uuid(),
  categoryId: z.string().uuid(),
  priority: z.enum(['low', 'normal', 'high', 'emergency']).default('normal'),
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().min(10, 'Опишите проблему подробнее (минимум 10 символов)').max(4000),
  contactPhone: phoneSchema,
  locationNote: z.string().trim().max(200).optional(),
});

const staffCreateSchema = z.object({
  buildingId: z.string().uuid(),
  apartmentId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid(),
  priority: z.enum(['low', 'normal', 'high', 'emergency']).default('normal'),
  source: z.enum(['dispatcher_phone', 'dispatcher_walkin']),
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().min(5).max(4000),
  locationNote: z.string().trim().max(200).optional(),
  contactPhone: phoneSchema,
  contactName: z.string().trim().max(200).optional(),
});

const commentSchema = z.object({
  body: z.string().trim().min(1, 'Комментарий не может быть пустым').max(4000),
  isInternal: z.boolean().default(false),
});

const closeSchema = z.object({
  resolutionNote: z
    .string()
    .trim()
    .min(5, 'Опишите, что именно сделано')
    .max(2000),
});

const rejectSchema = z.object({
  reason: z.string().trim().min(3, 'Укажите причину отклонения').max(1000),
});

const statusSchema = z.object({
  to: z.enum(['in_progress', 'waiting', 'done']),
  comment: z.string().trim().max(2000).optional(),
});

const assignSchema = z.object({
  assigneeId: z.string().uuid(),
});

const listQuerySchema = z.object({
  status: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  buildingId: z.string().uuid().optional(),
  assignedTo: z.string().max(50).optional(),
  priority: z.enum(['low', 'normal', 'high', 'emergency']).optional(),
  onlyOverdue: z.coerce.boolean().optional(),
  onlyEmergency: z.coerce.boolean().optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['createdAt', 'slaDueAt', 'priority']).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().max(500).optional(),
});

/** Кто действует: от этого зависят допустимые переходы статусов. */
function actorKind(auth: AuthContext): 'admin' | 'dispatcher' | 'executor' {
  if (auth.roles.includes('uk_admin')) return 'admin';
  if (auth.roles.includes('dispatcher')) return 'dispatcher';
  return 'executor';
}

function scopeFor(auth: AuthContext): 'all' | 'assigned' {
  return auth.permissions.has('ticket.view.all') ? 'all' : 'assigned';
}

function tenantOrFail(
  request: Parameters<typeof fail>[0],
  reply: Parameters<typeof fail>[1],
  auth: AuthContext | null,
): string | null {
  if (!auth) {
    fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');
    return null;
  }
  if (!auth.tenantId) {
    fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
    return null;
  }
  return auth.tenantId;
}

// ─── Житель ─────────────────────────────────────────────────────────────────

export async function residentTicketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tickets', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const query = z
      .object({ limit: z.coerce.number().int().positive().max(100).default(20), cursor: z.string().max(500).optional() })
      .parse(request.query);

    const page = await listResidentTickets(auth.userId, clampLimit(query.limit), query.cursor);
    return reply.send({ items: page.items, nextCursor: page.nextCursor, hasMore: Boolean(page.nextCursor) });
  });

  app.post('/tickets', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const input = residentCreateSchema.parse(request.body);

    // Главная проверка: заявку можно создать только по ПОДТВЕРЖДЁННОЙ привязке.
    // Без неё любой мог бы писать заявки от имени чужой квартиры.
    const bound = await hasConfirmedBinding(auth.userId, input.apartmentId);
    if (!bound) {
      return fail(
        request,
        reply,
        403,
        'BINDING_NOT_CONFIRMED',
        'Сначала подтвердите привязку к квартире — заявку можно создать только после этого',
      );
    }

    // УК и дом определяем по квартире, а не доверяем клиенту
    const aptRes = await query<{ tenant_id: string; building_id: string }>(
      'SELECT tenant_id, building_id FROM apartments WHERE id = $1 AND deleted_at IS NULL',
      [input.apartmentId],
    );
    const apt = aptRes.rows[0];
    if (!apt) return fail(request, reply, 404, 'NOT_FOUND', 'Квартира не найдена');

    const created = await createTicket({
      tenantId: apt.tenant_id,
      buildingId: apt.building_id,
      apartmentId: input.apartmentId,
      categoryId: input.categoryId,
      priority: input.priority,
      source: 'resident_app',
      title: input.title ?? null,
      description: input.description,
      locationNote: input.locationNote ?? null,
      contactPhone: input.contactPhone,
      createdBy: auth.userId,
    });

    if (!created.ok) return fail(request, reply, 404, created.code, created.message);

    await writeAudit({
      tenantId: apt.tenant_id,
      actorUserId: auth.userId,
      actorIp: request.ip,
      action: 'ticket.create',
      entityType: 'ticket',
      entityId: created.data.id,
      after: { number: created.data.number, source: 'resident_app' },
    });

    return reply.status(201).send(created.data);
  });

  app.get<{ Params: { id: string } }>(
    '/tickets/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const result = await getTicketForResident(auth.userId, idParsed.data);
      if (!result.ok) return fail(request, reply, 404, result.code, result.message);
      return reply.send(result.data);
    },
  );

  // История статусов для жителя.
  //
  // Зачем: комментарий обязателен при переводе в «ожидает» и «выполнена»,
  // и без этого эндпоинта житель видел только новый статус — без объяснения,
  // что именно сделали и чего ждут. Доступ проверяется по владению заявкой.
  app.get<{ Params: { id: string } }>(
    '/tickets/:id/history',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const ticket = await getTicketForResident(auth.userId, idParsed.data);
      if (!ticket.ok) return fail(request, reply, 404, ticket.code, ticket.message);

      const items = await listHistory(ticket.data.tenantId, idParsed.data);
      return reply.send({ items });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/tickets/:id/comments',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const input = commentSchema.parse(request.body);
      // Жителю внутренние комментарии недоступны — принудительно false
      if (input.isInternal) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Служебные комментарии доступны только сотрудникам');
      }

      const ticket = await getTicketForResident(auth.userId, idParsed.data);
      if (!ticket.ok) return fail(request, reply, 404, ticket.code, ticket.message);

      const result = await addComment({
        tenantId: ticket.data.tenantId,
        ticketId: idParsed.data,
        authorId: auth.userId,
        body: input.body,
        isInternal: false,
      });
      if (!result.ok) return fail(request, reply, 404, result.code, result.message);
      return reply.status(201).send(result.data);
    },
  );

  // «Проблема не решена» — создаёт НОВУЮ заявку со ссылкой на исходную.
  // Это замена «повторного открытия» по решению C.
  app.post<{ Params: { id: string } }>(
    '/tickets/:id/report-problem',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const input = z
        .object({
          description: z.string().trim().min(10, 'Опишите, что осталось не решено').max(4000),
        })
        .parse(request.body);

      const base = await getTicketBasicsForRepeat(auth.userId, idParsed.data);
      if (!base.ok) return fail(request, reply, 404, base.code, base.message);

      if (base.data.statusCode !== 'closed') {
        return fail(request, reply, 409, 'CONFLICT', 'Повторное обращение возможно только по закрытой заявке');
      }

      const allowed = await canRepeatWithinDay(idParsed.data);
      if (!allowed) {
        return fail(
          request,
          reply,
          429,
          'REPEAT_TOO_SOON',
          'По этой заявке уже создано повторное обращение. Подождите сутки или позвоните в УК.',
        );
      }

      // Телефон берём из профиля: житель уже авторизован
      const phoneRes = await query<{ phone: string | null }>(
        'SELECT phone FROM users WHERE id = $1',
        [auth.userId],
      );
      const phone = phoneRes.rows[0]?.phone;
      if (!phone) {
        return fail(request, reply, 422, 'PHONE_REQUIRED', 'Укажите телефон в профиле');
      }

      const created = await createTicket({
        tenantId: base.data.tenantId,
        buildingId: base.data.buildingId,
        apartmentId: base.data.apartmentId,
        categoryId: base.data.categoryId,
        priority: 'high',
        source: 'resident_app',
        title: 'Повторное обращение',
        description: input.description,
        contactPhone: phone,
        createdBy: auth.userId,
        parentTicketId: idParsed.data,
      });

      if (!created.ok) return fail(request, reply, 404, created.code, created.message);
      return reply.status(201).send(created.data);
    },
  );

  // Удаление своей заявки.
  //
  // Мягкое: строка остаётся в базе и в аудите, но исчезает из списков.
  // Житель может убрать заявку, которую создал сам; чужие — нет.
  app.delete<{ Params: { id: string } }>(
    '/tickets/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const res = await query<{ tenant_id: string; number: number }>(
        `UPDATE tickets
            SET deleted_at = now()
          WHERE id = $1 AND created_by = $2 AND deleted_at IS NULL
        RETURNING tenant_id, number`,
        [idParsed.data, auth.userId],
      );

      const row = res.rows[0];
      if (!row) {
        // Чужая заявка и несуществующая неразличимы — 404 в обоих случаях
        return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');
      }

      await writeAudit({
        tenantId: row.tenant_id,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'ticket.delete',
        entityType: 'ticket',
        entityId: idParsed.data,
        after: { number: row.number, by: 'resident' },
      });

      return reply.status(204).send();
    },
  );

  // ─── Фотографии и документы заявки ───────────────────────────────────────
  // Файл отдаётся только через API: публичной ссылки нет, права проверяются
  // на каждом запросе. Житель видит вложения только своей заявки.
  app.post<{ Params: { id: string }; Querystring: { kind?: string; commentId?: string } }>(
    '/tickets/:id/attachments',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      if (!(await canResidentSeeTicket(auth.userId, idParsed.data))) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');
      }

      const file = await request.file();
      if (!file) {
        return fail(request, reply, 400, 'NO_FILE', 'Файл не передан');
      }

      const kindRaw = request.query.kind ?? 'request_photo';
      const kind: AttachmentKind =
        kindRaw === 'result_photo' || kindRaw === 'document' || kindRaw === 'comment_file'
          ? kindRaw
          : 'request_photo';

      const buffer = await file.toBuffer();
      const result = await saveAttachment({
        tenantId: auth.tenantId ?? '',
        ticketId: idParsed.data,
        userId: auth.userId,
        kind,
        originalName: file.filename || 'photo',
        buffer,
        commentId: request.query.commentId ?? null,
      });

      if (!result.ok) {
        return fail(request, reply, 400, result.code, result.message);
      }

      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'ticket.attachment_upload',
        entityType: 'ticket',
        entityId: idParsed.data,
        after: { attachmentId: result.item.id, mimeType: result.item.mimeType },
      });

      return reply.status(201).send(result.item);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/tickets/:id/attachments',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      if (!(await canResidentSeeTicket(auth.userId, idParsed.data))) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');
      }

      const items = await listAttachments(idParsed.data);
      return reply.send({ items });
    },
  );

  app.get<{ Params: { id: string; attachmentId: string } }>(
    '/tickets/:id/attachments/:attachmentId',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      const attachmentParsed = z.string().uuid().safeParse(request.params.attachmentId);
      if (!idParsed.success || !attachmentParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Файл не найден');
      }

      if (!(await canResidentSeeTicket(auth.userId, idParsed.data))) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Файл не найден');
      }

      const file = await openAttachment(idParsed.data, attachmentParsed.data);
      if (!file) return fail(request, reply, 404, 'NOT_FOUND', 'Файл не найден');

      return reply
        .header('Content-Type', file.mimeType)
        // PDF отдаём как скачивание: иначе браузер открывает его inline
        .header(
          'Content-Disposition',
          `${file.mimeType === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        )
        .header('Cache-Control', 'private, max-age=300')
        .send(file.stream);
    },
  );
}

// ─── Сотрудники УК ──────────────────────────────────────────────────────────

export async function staffTicketRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    { preHandler: [app.authenticate, app.requirePermission('ticket.view.all')] },
    async (request, reply) => {
      const auth = request.auth;
      const tenantId = tenantOrFail(request, reply, auth);
      if (!tenantId || !auth) return;

      const query = listQuerySchema.parse(request.query);
      const filters: ListFilters = {
        status: query.status ? query.status.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        categoryId: query.categoryId,
        buildingId: query.buildingId,
        assignedTo: query.assignedTo,
        priority: query.priority,
        onlyOverdue: query.onlyOverdue,
        onlyEmergency: query.onlyEmergency,
        q: query.q,
        sort: query.sort,
        limit: clampLimit(query.limit),
        cursor: query.cursor,
      };

      const page = await listTickets(tenantId, { kind: 'all' }, filters);
      return reply.send({ items: page.items, nextCursor: page.nextCursor, hasMore: Boolean(page.nextCursor) });
    },
  );

  app.get(
    '/assigned',
    { preHandler: [app.authenticate, app.requirePermission('ticket.view.assigned')] },
    async (request, reply) => {
      const auth = request.auth;
      const tenantId = tenantOrFail(request, reply, auth);
      if (!tenantId || !auth) return;

      const query = listQuerySchema.parse(request.query);
      const page = await listTickets(
        tenantId,
        { kind: 'assigned', userId: auth.userId },
        {
          status: query.status ? query.status.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          limit: clampLimit(query.limit),
          cursor: query.cursor,
          sort: query.sort,
          onlyOverdue: query.onlyOverdue,
        },
      );
      return reply.send({ items: page.items, nextCursor: page.nextCursor, hasMore: Boolean(page.nextCursor) });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      const tenantId = tenantOrFail(request, reply, auth);
      if (!tenantId || !auth) return;

      const canAll = auth.permissions.has('ticket.view.all');
      const canAssigned = auth.permissions.has('ticket.view.assigned');
      if (!canAll && !canAssigned) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Недостаточно прав для просмотра заявки');
      }

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const scope = canAll ? 'all' : 'assigned';
      const result = await getTicketForStaff(tenantId, idParsed.data, scope, auth.userId);
      if (!result.ok) return fail(request, reply, 404, result.code, result.message);
      return reply.send(result.data);
    },
  );

  app.post(
    '/',
    { preHandler: [app.authenticate, app.requirePermission('ticket.create')] },
    async (request, reply) => {
      const auth = request.auth;
      const tenantId = tenantOrFail(request, reply, auth);
      if (!tenantId || !auth) return;

      const input = staffCreateSchema.parse(request.body);

      const buildingRes = await query<{ id: string }>(
        'SELECT id FROM buildings WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
        [input.buildingId, tenantId],
      );
      if (!buildingRes.rows[0]) return fail(request, reply, 404, 'NOT_FOUND', 'Дом не найден');

      // Квартира, если указана, должна принадлежать тому же дому и УК
      if (input.apartmentId) {
        const aptRes = await query<{ id: string }>(
          'SELECT id FROM apartments WHERE id = $1 AND building_id = $2 AND tenant_id = $3 AND deleted_at IS NULL',
          [input.apartmentId, input.buildingId, tenantId],
        );
        if (!aptRes.rows[0]) return fail(request, reply, 404, 'NOT_FOUND', 'Квартира не найдена в этом доме');
      }

      const created = await createTicket({
        tenantId,
        buildingId: input.buildingId,
        apartmentId: input.apartmentId ?? null,
        categoryId: input.categoryId,
        priority: input.priority,
        source: input.source,
        title: input.title ?? null,
        description: input.description,
        locationNote: input.locationNote ?? null,
        contactPhone: input.contactPhone,
        contactName: input.contactName ?? null,
        createdBy: auth.userId,
      });

      if (!created.ok) return fail(request, reply, 404, created.code, created.message);

      await writeAudit({
        tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'ticket.create',
        entityType: 'ticket',
        entityId: created.data.id,
        after: { number: created.data.number, source: input.source },
      });

      return reply.status(201).send(created.data);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/accept',
    { preHandler: [app.authenticate, app.requirePermission('ticket.accept')] },
    async (request, reply) => {
      const auth = request.auth;
      const tenantId = tenantOrFail(request, reply, auth);
      if (!tenantId || !auth) return;

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const result = await transitionStatus({
        tenantId,
        ticketId: idParsed.data,
        toCode: 'accepted',
        byUserId: auth.userId,
        scope: scopeFor(auth),
        actorKind: actorKind(auth),
      });
      if (!result.ok) return fail(request, reply, 409, result.code, result.message);

      await writeAudit({
        tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'ticket.status_change',
        entityType: 'ticket',
        entityId: idParsed.data,
        after: { to: 'accepted' },
      });
      return reply.send(result.data);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/assign',
    { preHandler: [app.authenticate, app.requirePermission('ticket.assign')] },
    async (request, reply) => {
      const auth = request.auth;
      const tenantId = tenantOrFail(request, reply, auth);
      if (!tenantId || !auth) return;

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const input = assignSchema.parse(request.body);
      const result = await assignTicket({
        tenantId,
        ticketId: idParsed.data,
        assigneeId: input.assigneeId,
        byUserId: auth.userId,
      });
      if (!result.ok) {
        const status = result.code === 'NOT_FOUND' ? 404 : 409;
        return fail(request, reply, status, result.code, result.message);
      }

      await writeAudit({
        tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'ticket.assign',
        entityType: 'ticket',
        entityId: idParsed.data,
        after: { assigneeId: input.assigneeId },
      });
      return reply.send(result.data);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/status',
    { preHandler: [app.authenticate, app.requirePermission('ticket.status.change')] },
    async (request, reply) => {
      const auth = request.auth;
      const tenantId = tenantOrFail(request, reply, auth);
      if (!tenantId || !auth) return;

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const input = statusSchema.parse(request.body);
      const result = await transitionStatus({
        tenantId,
        ticketId: idParsed.data,
        toCode: input.to,
        byUserId: auth.userId,
        scope: scopeFor(auth),
        actorKind: actorKind(auth),
        comment: input.comment,
      });
      if (!result.ok) {
        const status =
          result.code === 'NOT_FOUND' ? 404 : result.code === 'FORBIDDEN' ? 403 : 409;
        return fail(request, reply, status, result.code, result.message);
      }

      await writeAudit({
        tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'ticket.status_change',
        entityType: 'ticket',
        entityId: idParsed.data,
        after: { to: input.to, comment: input.comment ?? null },
      });
      return reply.send(result.data);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/close',
    // Право проверяет не маршрут, а логика перехода: закрыть может тот, кому
    // заявка назначена, даже если он диспетчер. Роли здесь мало — важна
    // привязка к конкретной заявке, а её видно только в transitionStatus.
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      const tenantId = tenantOrFail(request, reply, auth);
      if (!tenantId || !auth) return;

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const input = closeSchema.parse(request.body);
      const result = await transitionStatus({
        tenantId,
        ticketId: idParsed.data,
        toCode: 'closed',
        byUserId: auth.userId,
        scope: scopeFor(auth),
        actorKind: actorKind(auth),
        resolutionNote: input.resolutionNote,
      });
      if (!result.ok) {
        const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'FORBIDDEN' ? 403 : 409;
        return fail(request, reply, status, result.code, result.message);
      }

      await writeAudit({
        tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'ticket.status_change',
        entityType: 'ticket',
        entityId: idParsed.data,
        after: { to: 'closed', resolutionNote: input.resolutionNote },
      });
      return reply.send(result.data);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/reject',
    { preHandler: [app.authenticate, app.requirePermission('ticket.reject')] },
    async (request, reply) => {
      const auth = request.auth;
      const tenantId = tenantOrFail(request, reply, auth);
      if (!tenantId || !auth) return;

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const input = rejectSchema.parse(request.body);
      const result = await transitionStatus({
        tenantId,
        ticketId: idParsed.data,
        toCode: 'rejected',
        byUserId: auth.userId,
        scope: scopeFor(auth),
        actorKind: actorKind(auth),
        comment: input.reason,
      });
      if (!result.ok) {
        const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'FORBIDDEN' ? 403 : 409;
        return fail(request, reply, status, result.code, result.message);
      }

      await writeAudit({
        tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'ticket.status_change',
        entityType: 'ticket',
        entityId: idParsed.data,
        after: { to: 'rejected', reason: input.reason },
      });
      return reply.send(result.data);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/:id/history',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      const tenantId = tenantOrFail(request, reply, auth);
      if (!tenantId || !auth) return;

      const canAll = auth.permissions.has('ticket.view.all');
      const canAssigned = auth.permissions.has('ticket.view.assigned');
      if (!canAll && !canAssigned) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Недостаточно прав');
      }

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      // Сначала проверяем доступ к самой заявке
      const ticket = await getTicketForStaff(
        tenantId,
        idParsed.data,
        canAll ? 'all' : 'assigned',
        auth.userId,
      );
      if (!ticket.ok) return fail(request, reply, 404, ticket.code, ticket.message);

      const items = await listHistory(tenantId, idParsed.data);
      return reply.send({ items });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/comments',
    { preHandler: [app.authenticate, app.requirePermission('ticket.comment.create')] },
    async (request, reply) => {
      const auth = request.auth;
      const tenantId = tenantOrFail(request, reply, auth);
      if (!tenantId || !auth) return;

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const input = commentSchema.parse(request.body);
      if (input.isInternal && !auth.permissions.has('ticket.comment.internal')) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Служебные комментарии недоступны вашей роли');
      }

      const ticket = await getTicketForStaff(
        tenantId,
        idParsed.data,
        scopeFor(auth),
        auth.userId,
      );
      if (!ticket.ok) return fail(request, reply, 404, ticket.code, ticket.message);

      const result = await addComment({
        tenantId,
        ticketId: idParsed.data,
        authorId: auth.userId,
        body: input.body,
        isInternal: input.isInternal,
      });
      if (!result.ok) return fail(request, reply, 404, result.code, result.message);
      return reply.status(201).send(result.data);
    },
  );

  /**
   * Загрузка фото сотрудником УК.
   *
   * Нужна для фотоотчёта при закрытии заявки и для снимков в комментариях:
   * исполнитель видит проблему глазами и подтверждает результат снимком.
   */
  app.post<{ Params: { id: string }; Querystring: { kind?: string; commentId?: string } }>(
    '/:id/attachments',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const allowed =
        auth.permissions.has('ticket.view.all') || auth.permissions.has('ticket.view.assigned');
      if (!allowed) return fail(request, reply, 403, 'FORBIDDEN', 'Недостаточно прав');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const visible = await canStaffSeeTicket(
        auth.userId,
        auth.tenantId,
        idParsed.data,
        auth.permissions.has('ticket.view.all'),
      );
      if (!visible) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const file = await request.file();
      if (!file) return fail(request, reply, 400, 'NO_FILE', 'Файл не передан');

      const kindRaw = request.query.kind ?? 'result_photo';
      const kind: AttachmentKind =
        kindRaw === 'request_photo' || kindRaw === 'document' || kindRaw === 'comment_file'
          ? kindRaw
          : 'result_photo';

      const buffer = await file.toBuffer();
      const result = await saveAttachment({
        tenantId: auth.tenantId ?? '',
        ticketId: idParsed.data,
        userId: auth.userId,
        kind,
        originalName: file.filename || 'photo',
        buffer,
        commentId: request.query.commentId ?? null,
      });

      if (!result.ok) return fail(request, reply, 400, result.code, result.message);

      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'ticket.attachment_upload',
        entityType: 'ticket',
        entityId: idParsed.data,
        after: { attachmentId: result.item.id, kind },
      });

      return reply.status(201).send(result.item);
    },
  );

  /**
   * Список вложений заявки для сотрудника УК.
   *
   * Без этого маршрута диспетчер видел заявку без фотографий: карточка
   * запрашивала жительский адрес, а он отдаёт только свои заявки и на чужую
   * отвечает 404. Права те же, что на просмотр файла.
   */
  app.get<{ Params: { id: string } }>(
    '/:id/attachments',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const allowed =
        auth.permissions.has('ticket.view.all') || auth.permissions.has('ticket.view.assigned');
      if (!allowed) return fail(request, reply, 403, 'FORBIDDEN', 'Недостаточно прав');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const visible = await canStaffSeeTicket(
        auth.userId,
        auth.tenantId,
        idParsed.data,
        auth.permissions.has('ticket.view.all'),
      );
      if (!visible) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const items = await listAttachments(idParsed.data);
      return reply.send({ items });
    },
  );

  /**
   * Фото заявки для сотрудника УК.
   *
   * Диспетчеру и исполнителю фотография нужна не меньше, чем жителю:
   * по ней решают, кого и с каким инструментом отправлять. Проверяем
   * одно из двух прав, а принадлежность к УК — в запросе вложения.
   */
  app.get<{ Params: { id: string; attachmentId: string } }>(
    '/:id/attachments/:attachmentId',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const allowed =
        auth.permissions.has('ticket.view.all') || auth.permissions.has('ticket.view.assigned');
      if (!allowed) return fail(request, reply, 403, 'FORBIDDEN', 'Недостаточно прав');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      const attachmentParsed = z.string().uuid().safeParse(request.params.attachmentId);
      if (!idParsed.success || !attachmentParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Файл не найден');
      }

      // Файл ищется вместе с заявкой: чужая УК получит 404, как и на несуществующий
      const visible = await canStaffSeeTicket(
        auth.userId,
        auth.tenantId,
        idParsed.data,
        auth.permissions.has('ticket.view.all'),
      );
      if (!visible) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const file = await openAttachment(idParsed.data, attachmentParsed.data);
      if (!file) return fail(request, reply, 404, 'NOT_FOUND', 'Файл не найден');

      return reply
        .header('Content-Type', file.mimeType)
        // PDF отдаём как скачивание: иначе браузер открывает его inline
        .header(
          'Content-Disposition',
          `${file.mimeType === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        )
        .header('Cache-Control', 'private, max-age=300')
        .send(file.stream);
    },
  );
}
