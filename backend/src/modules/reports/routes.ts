/** Отчёты и просрочки для кабинета УК. */
import type { FastifyInstance } from 'fastify';
import { fail } from '../../lib/http.js';
import { getReportSummary } from './service.js';

export async function staffReportRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    { preHandler: [app.authenticate, app.requirePermission('report.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      return reply.send(await getReportSummary(auth.tenantId));
    },
  );
}
