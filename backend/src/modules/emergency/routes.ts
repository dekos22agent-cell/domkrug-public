/**
 * Маршруты экстренных сообщений и вызовов жителя.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { writeAudit } from '../auth/service.js';
import { cancelCall, createCall, listCallsForUser, listMessagesForUser } from './service.js';

const callSchema = z.object({
  kind: z.enum(['uk_duty', 'police', 'ambulance', 'fire', 'gas']),
  locationNote: z.string().trim().max(300).optional(),
});

export async function residentEmergencyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/messages', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const items = await listMessagesForUser(auth.userId);
    return reply.send({ items });
  });

  app.get('/calls', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const items = await listCallsForUser(auth.userId);
    return reply.send({ items });
  });

  app.post('/calls', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const input = callSchema.parse(request.body);
    const result = await createCall(auth.userId, input.kind, input.locationNote ?? null);

    if (!result.ok) {
      return fail(
        request,
        reply,
        result.status ?? 400,
        result.code ?? 'ERROR',
        result.message ?? 'Не удалось создать вызов',
      );
    }

    await writeAudit({
      actorUserId: auth.userId,
      actorIp: request.ip,
      action: 'emergency.call',
      entityType: 'emergency_call',
      entityId: result.call?.id ?? null,
      after: { kind: input.kind, locationNote: input.locationNote ?? null },
    });

    return reply.status(201).send({ call: result.call });
  });

  app.post<{ Params: { id: string } }>(
    '/calls/:id/cancel',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Вызов не найден');

      const done = await cancelCall(auth.userId, idParsed.data);
      if (!done) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Вызов уже принят или не найден');
      }
      return reply.status(204).send();
    },
  );
}
