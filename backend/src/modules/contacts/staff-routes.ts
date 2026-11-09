/** Полезные телефоны: управление из кабинета УК. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { pool } from '../../db/pool.js';
import { writeAudit } from '../auth/service.js';

const CONTACT_KINDS = ['uk', 'district', 'provider', 'clinic', 'emergency', 'other'] as const;

const inputSchema = z.object({
  kind: z.enum(CONTACT_KINDS),
  name: z.string().trim().min(2, 'Укажите название').max(200),
  phone: z.string().trim().min(5, 'Укажите телефон').max(100),
  note: z.string().trim().max(300).nullable().optional(),
  buildingId: z.string().uuid().nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});

interface Row {
  id: string;
  kind: string;
  name: string;
  phone: string;
  note: string | null;
  building_id: string | null;
  building_address: string | null;
  sort_order: number;
}

const SELECT = `
  SELECT c.id, c.kind, c.name, c.phone, c.note, c.building_id,
         b.address_text AS building_address, c.sort_order
    FROM contacts c
    LEFT JOIN buildings b ON b.id = c.building_id`;

function toItem(row: Row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    phone: row.phone,
    note: row.note,
    buildingId: row.building_id,
    buildingAddress: row.building_address,
    sortOrder: row.sort_order,
  };
}

export async function staffContactRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    { preHandler: [app.authenticate, app.requirePermission('building.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      const res = await pool.query<Row>(
        `${SELECT} WHERE c.tenant_id = $1 ORDER BY c.kind, c.sort_order, c.name`,
        [auth.tenantId],
      );
      return reply.send({ items: res.rows.map(toItem) });
    },
  );

  app.post(
    '/',
    { preHandler: [app.authenticate, app.requirePermission('building.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      const parsed = inputSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(request, reply, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Проверьте телефон');
      }
      const input = parsed.data;
      if (input.buildingId) {
        const building = await pool.query(
          `SELECT 1 FROM buildings WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          [input.buildingId, auth.tenantId],
        );
        if ((building.rowCount ?? 0) === 0) {
          return fail(request, reply, 404, 'NOT_FOUND', 'Дом не найден');
        }
      }
      const res = await pool.query<Row>(
        `INSERT INTO contacts (tenant_id, building_id, kind, name, phone, note, sort_order)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
         RETURNING id, kind, name, phone, note, building_id, NULL::text AS building_address, sort_order`,
        [auth.tenantId, input.buildingId ?? null, input.kind, input.name, input.phone, input.note ?? null, input.sortOrder ?? 0],
      );
      const item = res.rows[0]!;
      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'contact.create',
        entityType: 'contact',
        entityId: item.id,
        after: { kind: item.kind, name: item.name },
      });
      return reply.status(201).send(toItem(item));
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate, app.requirePermission('building.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      const id = z.string().uuid().safeParse(request.params.id);
      if (!id.success) return fail(request, reply, 404, 'NOT_FOUND', 'Телефон не найден');
      const parsed = inputSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(request, reply, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Проверьте телефон');
      }
      const input = parsed.data;
      if (input.buildingId) {
        const building = await pool.query(
          `SELECT 1 FROM buildings WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          [input.buildingId, auth.tenantId],
        );
        if ((building.rowCount ?? 0) === 0) {
          return fail(request, reply, 404, 'NOT_FOUND', 'Дом не найден');
        }
      }
      const res = await pool.query<Row>(
        `UPDATE contacts c
            SET kind = $3, name = $4, phone = $5, note = $6, building_id = $7::uuid, sort_order = $8
          WHERE c.id = $1 AND c.tenant_id = $2
          RETURNING c.id, c.kind, c.name, c.phone, c.note, c.building_id,
                    (SELECT address_text FROM buildings b WHERE b.id = c.building_id) AS building_address,
                    c.sort_order`,
        [id.data, auth.tenantId, input.kind, input.name, input.phone, input.note ?? null, input.buildingId ?? null, input.sortOrder ?? 0],
      );
      const item = res.rows[0];
      if (!item) return fail(request, reply, 404, 'NOT_FOUND', 'Телефон не найден');
      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'contact.update',
        entityType: 'contact',
        entityId: item.id,
        after: { kind: item.kind, name: item.name },
      });
      return reply.send(toItem(item));
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate, app.requirePermission('building.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      const id = z.string().uuid().safeParse(request.params.id);
      if (!id.success) return fail(request, reply, 404, 'NOT_FOUND', 'Телефон не найден');
      const res = await pool.query(
        'DELETE FROM contacts WHERE id = $1 AND tenant_id = $2',
        [id.data, auth.tenantId],
      );
      if ((res.rowCount ?? 0) === 0) return fail(request, reply, 404, 'NOT_FOUND', 'Телефон не найден');
      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'contact.delete',
        entityType: 'contact',
        entityId: id.data,
      });
      return reply.status(204).send();
    },
  );
}
