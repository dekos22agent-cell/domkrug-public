import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { writeAudit } from '../auth/service.js';
import {
  createDocument,
  listDocumentsForResident,
  listDocumentsForTenant,
  publishDocument,
} from './service.js';

const category = z.enum(['house', 'apartment', 'receipt', 'other']);

const createSchema = z.object({
  title: z.string().trim().min(2, 'Укажите название').max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  category,
  url: z.string().trim().url('Укажите ссылку http(s)').max(2000),
  buildingId: z.string().uuid().nullable().optional(),
  publish: z.boolean().default(false),
});

export async function residentDocumentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');
    return reply.send({ items: await listDocumentsForResident(auth.userId) });
  });
}

export async function staffDocumentRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    { preHandler: [app.authenticate, app.requirePermission('news.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      return reply.send({ items: await listDocumentsForTenant(auth.tenantId) });
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
          parsed.error.issues[0]?.message ?? 'Проверьте документ',
        );
      }

      const item = await createDocument({
        tenantId: auth.tenantId,
        buildingId: parsed.data.buildingId ?? null,
        title: parsed.data.title,
        description: parsed.data.description || null,
        category: parsed.data.category,
        url: parsed.data.url,
        publish: parsed.data.publish,
        authorId: auth.userId,
      });
      if (!item) return fail(request, reply, 404, 'NOT_FOUND', 'Дом не найден');

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'document.create',
        entityType: 'document',
        entityId: item.id,
        after: { published: Boolean(item.publishedAt), category: item.category },
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
      if (!id.success) return fail(request, reply, 404, 'NOT_FOUND', 'Документ не найден');

      const item = await publishDocument(auth.tenantId, id.data);
      if (!item) return fail(request, reply, 404, 'NOT_FOUND', 'Документ не найден');

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'document.publish',
        entityType: 'document',
        entityId: item.id,
      });
      return reply.send(item);
    },
  );
}
