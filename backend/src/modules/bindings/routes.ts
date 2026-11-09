/**
 * Маршруты привязки жителей: своя (для жителя) и обработка (для УК).
 *
 * Житель работает только со своими привязками — право не требуется,
 * принадлежность проверяется по user_id из токена.
 * Сотрудник УК — по правам resident_binding.* и tenant_id из токена.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { clampLimit } from '../../lib/pagination.js';
import { scaledLimit } from '../../lib/limits.js';
import { getBindings, writeAudit } from '../auth/service.js';
import {
  confirmBinding,
  createBinding,
  listTenantBindings,
  rejectBinding,
  revokeOwnBinding,
  searchApartments,
} from './service.js';

const createSchema = z.object({
  apartmentId: z.string().uuid('Некорректный идентификатор квартиры'),
  roleInApartment: z.enum(['owner', 'renter', 'representative']).default('owner'),
});

const searchSchema = z.object({
  // Минимум 3 символа: иначе поиск по «1» вернёт весь город
  address: z.string().trim().min(3, 'Укажите адрес (минимум 3 символа)').max(200),
  apartment: z.string().trim().max(20).optional(),
});

const rejectSchema = z.object({
  reason: z.string().trim().min(3, 'Укажите причину отказа').max(500),
});

const listQuerySchema = z.object({
  status: z.enum(['pending', 'confirmed', 'rejected']).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().max(500).optional(),
});

export async function residentBindingRoutes(app: FastifyInstance): Promise<void> {
  // Мои привязки
  app.get('/bindings', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');
    const items = await getBindings(auth.userId);
    return reply.send({ items });
  });

  // Поиск квартиры для привязки
  app.get(
    '/search-apartment',
    {
      preHandler: [app.authenticate],
      // Ограничение частоты: поиск не должен превращаться в инструмент
      // перебора адресов и квартир
      config: { rateLimit: { max: scaledLimit(30), timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const query = searchSchema.parse(request.query);
      const items = await searchApartments(auth.userId, query.address, query.apartment ?? null);
      return reply.send({ items });
    },
  );

  // Заявка на привязку
  app.post('/bindings', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const input = createSchema.parse(request.body);
    const result = await createBinding(auth.userId, input.apartmentId, input.roleInApartment);

    if (!result.ok) {
      const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'ALREADY_EXISTS' ? 409 : 422;
      return fail(request, reply, status, result.code, result.message);
    }

    await writeAudit({
      actorUserId: auth.userId,
      actorIp: request.ip,
      action: 'resident.binding_request',
      entityType: 'resident_binding',
      entityId: result.data.id,
      after: { apartmentNumber: result.data.apartmentNumber, role: input.roleInApartment },
    });

    return reply.status(201).send(result.data);
  });

  // Отзыв своей заявки (только необработанной)
  app.delete<{ Params: { id: string } }>(
    '/bindings/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Привязка не найдена');

      const result = await revokeOwnBinding(auth.userId, idParsed.data);
      if (!result.ok) {
        const status = result.code === 'NOT_FOUND' ? 404 : 409;
        return fail(request, reply, status, result.code, result.message);
      }

      // Отдельные действия в аудите: отмена заявки и отвязка подтверждённой
      // квартиры — разные события, по ним потом видно, почему у человека
      // пропал доступ
      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action:
          result.data.status === 'confirmed'
            ? 'resident.binding_revoke'
            : 'resident.binding_cancel',
        entityType: 'resident_binding',
        entityId: idParsed.data,
        before: {
          status: result.data.status,
          apartmentNumber: result.data.apartmentNumber,
        },
      });

      return reply.status(204).send();
    },
  );
}

export async function staffBindingRoutes(app: FastifyInstance): Promise<void> {
  // Список заявок на привязку
  app.get(
    '/',
    { preHandler: [app.authenticate, app.requirePermission('resident_binding.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const query = listQuerySchema.parse(request.query);
      const page = await listTenantBindings(auth.tenantId, {
        status: query.status,
        limit: clampLimit(query.limit, 20, 100),
        cursor: query.cursor,
      });
      return reply.send({ items: page.items, nextCursor: page.nextCursor, hasMore: Boolean(page.nextCursor) });
    },
  );

  // Подтверждение
  app.post<{ Params: { id: string } }>(
    '/:id/confirm',
    { preHandler: [app.authenticate, app.requirePermission('resident_binding.confirm')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const result = await confirmBinding(auth.tenantId, idParsed.data, auth.userId);
      if (!result.ok) {
        const status = result.code === 'NOT_FOUND' ? 404 : 409;
        return fail(request, reply, status, result.code, result.message);
      }

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'resident.confirm',
        entityType: 'resident_binding',
        entityId: idParsed.data,
      });

      return reply.send({ status: 'confirmed' });
    },
  );

  // Отклонение с обязательной причиной
  app.post<{ Params: { id: string } }>(
    '/:id/reject',
    { preHandler: [app.authenticate, app.requirePermission('resident_binding.reject')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Заявка не найдена');

      const input = rejectSchema.parse(request.body);
      const result = await rejectBinding(auth.tenantId, idParsed.data, input.reason);
      if (!result.ok) {
        const status = result.code === 'NOT_FOUND' ? 404 : 409;
        return fail(request, reply, status, result.code, result.message);
      }

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'resident.reject',
        entityType: 'resident_binding',
        entityId: idParsed.data,
        after: { reason: input.reason },
      });

      return reply.send({ status: 'rejected' });
    },
  );
}
