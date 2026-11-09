import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { writeAudit } from '../auth/service.js';
import {
  createNews,
  listNewsForResident,
  listNewsForTenant,
  publishNews,
} from './service.js';

const createSchema = z.object({
  title: z.string().trim().min(3, 'Укажите заголовок').max(200),
  body: z.string().trim().min(5, 'Добавьте текст объявления').max(5000),
  isEmergency: z.boolean().default(false),
  publish: z.boolean().default(false),
});

export async function residentNewsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');
    const items = await listNewsForResident(auth.userId);
    return reply.send({ items });
  });
}

export async function staffNewsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    { preHandler: [app.authenticate, app.requirePermission('news.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      const items = await listNewsForTenant(auth.tenantId);
      return reply.send({ items });
    },
  );

  app.post(
    '/',
    { preHandler: [app.authenticate, app.requirePermission('news.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message ?? 'Проверьте объявление',
        );
      }

      const item = await createNews({
        tenantId: auth.tenantId,
        title: parsed.data.title,
        body: parsed.data.body,
        isEmergency: parsed.data.isEmergency,
        publish: parsed.data.publish,
        authorId: auth.userId,
      });

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'news.create',
        entityType: 'news',
        entityId: item.id,
        after: { published: Boolean(item.publishedAt), emergency: item.isEmergency },
      });
      return reply.status(201).send(item);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/publish',
    { preHandler: [app.authenticate, app.requirePermission('news.publish')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      const id = z.string().uuid().safeParse(request.params.id);
      if (!id.success) return fail(request, reply, 404, 'NOT_FOUND', 'Объявление не найдено');

      const item = await publishNews(auth.tenantId, id.data, auth.userId);
      if (!item) return fail(request, reply, 404, 'NOT_FOUND', 'Объявление не найдено');

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'news.publish',
        entityType: 'news',
        entityId: item.id,
      });
      return reply.send(item);
    },
  );
}
