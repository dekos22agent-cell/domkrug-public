/** Журнал действий УК: только чтение для аудита. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { pool } from '../../db/pool.js';

export async function staffAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    { preHandler: [app.authenticate, app.requirePermission('audit.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const parsed = z
        .object({
          limit: z.coerce.number().int().min(1).max(200).default(100),
          action: z.string().trim().max(80).optional(),
          entityType: z.string().trim().max(60).optional(),
        })
        .safeParse(request.query);
      if (!parsed.success) {
        return fail(request, reply, 400, 'VALIDATION_ERROR', 'Проверьте фильтры');
      }

      const conditions = ['al.tenant_id = $1'];
      const params: unknown[] = [auth.tenantId];
      if (parsed.data.action) {
        params.push(parsed.data.action);
        conditions.push(`al.action = $${params.length}`);
      }
      if (parsed.data.entityType) {
        params.push(parsed.data.entityType);
        conditions.push(`al.entity_type = $${params.length}`);
      }
      params.push(parsed.data.limit);

      const res = await pool.query<{
        id: string;
        action: string;
        entity_type: string | null;
        entity_id: string | null;
        actor_name: string | null;
        actor_ip: string | null;
        created_at: Date;
        after: unknown;
      }>(
        `SELECT al.id::text, al.action, al.entity_type, al.entity_id,
                u.full_name AS actor_name, host(al.actor_ip) AS actor_ip,
                al.created_at, al.after
           FROM audit_log al
           LEFT JOIN users u ON u.id = al.actor_user_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY al.created_at DESC
          LIMIT $${params.length}`,
        params,
      );

      return reply.send({
        items: res.rows.map((row) => ({
          id: row.id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          actorName: row.actor_name,
          actorIp: row.actor_ip,
          createdAt: row.created_at.toISOString(),
          after: row.after,
        })),
      });
    },
  );
}
