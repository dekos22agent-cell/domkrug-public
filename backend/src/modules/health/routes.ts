/**
 * Служебные эндпоинты: живость и готовность.
 *
 * Без авторизации — их опрашивает Docker healthcheck и внешний мониторинг.
 * Поэтому здесь МИНИМУМ информации: никаких версий БД, конфигураций и
 * внутренних адресов.
 */
import type { FastifyInstance } from 'fastify';
import { pingDatabase } from '../../db/pool.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Живость: процесс отвечает. Не проверяет зависимости.
  app.get('/health', async () => ({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
  }));

  // Готовность: можно ли обслуживать запросы (БД доступна).
  app.get('/health/ready', async (_request, reply) => {
    const database = await pingDatabase();
    const status = database ? 'ok' : 'degraded';
    return reply.status(database ? 200 : 503).send({
      status,
      checks: { database },
    });
  });
}
