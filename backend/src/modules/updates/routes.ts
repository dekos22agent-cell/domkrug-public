/**
 * Маршрут сигнала обновлений.
 *
 * Один запрос на вкладку раз в несколько секунд. Права не требуются: каждый
 * получает отпечаток только по своим заявкам и своим уведомлениям.
 */
import type { FastifyInstance } from 'fastify';
import { fail } from '../../lib/http.js';
import { getUpdates } from './service.js';

export async function updatesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    return reply.send(await getUpdates(auth));
  });
}
