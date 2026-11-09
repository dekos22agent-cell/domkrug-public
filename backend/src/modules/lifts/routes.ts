/**
 * Маршруты лифтов жителя.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { writeAudit } from '../auth/service.js';
import { callLift, listLiftEventsForUser, listLiftsForUser, reportLiftFault } from './service.js';

const faultSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

export async function residentLiftRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const items = await listLiftsForUser(auth.userId);
    return reply.send({ items });
  });

  app.get<{ Querystring: { limit?: string } }>(
    '/events',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const limit = Number(request.query.limit ?? '20');
      const items = await listLiftEventsForUser(auth.userId, Number.isFinite(limit) ? limit : 20);
      return reply.send({ items });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/call',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Лифт не найден');

      const outcome = await callLift(auth.userId, idParsed.data);
      if (!outcome.ok) {
        return fail(request, reply, outcome.status, outcome.code, outcome.message);
      }

      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'lift.call',
        entityType: 'lift',
        entityId: idParsed.data,
      });

      return reply.status(201).send({ message: 'Лифт вызван' });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/fault',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Лифт не найден');

      const input = faultSchema.parse(request.body ?? {});
      const outcome = await reportLiftFault(auth.userId, idParsed.data, input.note ?? null);
      if (!outcome.ok) {
        return fail(request, reply, outcome.status, outcome.code, outcome.message);
      }

      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'lift.fault_report',
        entityType: 'lift',
        entityId: idParsed.data,
        after: { note: input.note ?? null },
      });

      return reply.status(201).send({
        message: outcome.ticketNumber
          ? `Заявка №${outcome.ticketNumber} создана и передана в управляющую компанию`
          : 'Сообщение передано в управляющую компанию',
        ticketNumber: outcome.ticketNumber ?? null,
      });
    },
  );
}
