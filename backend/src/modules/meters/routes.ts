/**
 * Маршруты счётчиков жителя.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { writeAudit } from '../auth/service.js';
import { listMetersForUser, listReadings, submitReading } from './service.js';

const submitSchema = z.object({
  value: z.number().finite().min(0).max(1_000_000),
});

export async function residentMeterRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const items = await listMetersForUser(auth.userId);
    return reply.send({ items });
  });

  app.get<{ Params: { id: string } }>(
    '/:id/readings',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Счётчик не найден');

      const items = await listReadings(auth.userId, idParsed.data);
      if (items === null) return fail(request, reply, 404, 'NOT_FOUND', 'Счётчик не найден');

      return reply.send({ items });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/readings',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Счётчик не найден');

      const input = submitSchema.parse(request.body);
      const outcome = await submitReading(auth.userId, idParsed.data, input.value);

      if (!outcome.ok) {
        return fail(request, reply, outcome.status, outcome.code, outcome.message);
      }

      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'meter.reading_submit',
        entityType: 'meter',
        entityId: idParsed.data,
        after: { period: outcome.period, value: outcome.value },
      });

      return reply.status(outcome.updated ? 200 : 201).send({
        period: outcome.period,
        value: outcome.value,
        updated: outcome.updated,
      });
    },
  );
}
