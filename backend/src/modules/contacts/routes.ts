/**
 * Маршруты полезных телефонов жителя.
 */
import type { FastifyInstance } from 'fastify';
import { fail } from '../../lib/http.js';
import { listContactsForUser } from './service.js';

export async function residentContactRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const items = await listContactsForUser(auth.userId);
    return reply.send({ items });
  });
}