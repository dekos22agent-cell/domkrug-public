/**
 * Маршруты доступа жителя.
 *
 * Только житель: сотрудник УК видит журнал в другом месте (появится позже
 * вместе с правами access.view). Не смешиваем две разные аудитории в одном
 * наборе маршрутов — иначе права придётся разбирать внутри обработчика.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { writeAudit } from '../auth/service.js';
import { listEventsForUser, listPointsForUser, openAccessPoint } from './service.js';

export async function residentAccessRoutes(app: FastifyInstance): Promise<void> {
  // ─── Точки доступа жителя ────────────────────────────────────────────────
  app.get('/points', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const items = await listPointsForUser(auth.userId);
    return reply.send({ items });
  });

  // ─── Открыть точку ───────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { source?: 'app' | 'widget' } | undefined }>(
    '/points/:id/open',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Точка доступа не найдена');
      }

      const source = request.body?.source === 'widget' ? 'widget' : 'app';
      const outcome = await openAccessPoint({
        userId: auth.userId,
        pointId: idParsed.data,
        source,
      });

      if (!outcome.ok) {
        return fail(request, reply, outcome.status, outcome.code, outcome.message);
      }

      // Аудит отдельно от журнала доступа: журнал читает житель, аудит —
      // служба безопасности и УК. Это разные аудитории и разный срок хранения.
      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'access.open',
        entityType: 'access_point',
        entityId: idParsed.data,
        after: { source },
      });

      return reply.send({
        message: outcome.message,
        holdSeconds: outcome.holdSeconds ?? null,
        openedAt: outcome.openedAt,
      });
    },
  );

  // ─── Журнал открытий жителя ──────────────────────────────────────────────
  app.get<{ Querystring: { limit?: string } }>(
    '/events',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const limit = Number(request.query.limit ?? '20');
      const items = await listEventsForUser(auth.userId, Number.isFinite(limit) ? limit : 20);
      return reply.send({ items });
    },
  );
}
