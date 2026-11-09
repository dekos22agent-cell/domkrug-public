/**
 * Маршруты уведомлений — общие для всех ролей.
 *
 * Отдельного права нет намеренно: свои уведомления — это личная лента, а не
 * ресурс УК. Каждый видит только адресованное ему, поэтому право проверять
 * нечего.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { listNotifications, markAllRead, markNotificationRead } from './service.js';

const listQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) {
      return fail(request, reply, 400, 'VALIDATION_ERROR', 'Проверьте параметры запроса');
    }

    const result = await listNotifications(auth.userId, parsed.data);
    return reply.send(result);
  });

  app.post<{ Params: { id: string } }>(
    '/:id/read',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const id = z.string().uuid().safeParse(request.params.id);
      if (!id.success) return fail(request, reply, 404, 'NOT_FOUND', 'Уведомление не найдено');

      const ok = await markNotificationRead(auth.userId, id.data);
      if (!ok) return fail(request, reply, 404, 'NOT_FOUND', 'Уведомление не найдено');

      return reply.send({ readAt: new Date().toISOString() });
    },
  );

  app.post('/read-all', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const updated = await markAllRead(auth.userId);
    return reply.send({ updated });
  });
}
