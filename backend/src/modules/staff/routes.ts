/**
 * Сотрудники УК: список, создание, роли и деактивация.
 *
 * Роль — право, staff — трудовые отношения. Деактивация убирает рабочие роли
 * в этой УК, иначе уволенный сохранил бы доступ к заявкам.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { pool } from '../../db/pool.js';
import { hashPasswordAsync } from '../../lib/password.js';
import { writeAudit } from '../auth/service.js';

const UK_ROLES = ['uk_admin', 'uk_manager', 'dispatcher', 'executor'] as const;

const createSchema = z.object({
  fullName: z.string().trim().min(2, 'Укажите имя').max(200),
  phone: z.string().trim().regex(/^\+7\d{10}$/, 'Телефон в формате +7XXXXXXXXXX'),
  email: z
    .union([z.string().trim().toLowerCase().email('Некорректный e-mail').max(254), z.literal('')])
    .optional(),
  password: z.string().min(8, 'Пароль не короче 8 символов').max(128),
  position: z.string().trim().max(120).optional(),
  roles: z.array(z.enum(UK_ROLES)).min(1, 'Выберите хотя бы одну роль'),
});

const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(200).optional(),
  position: z.string().trim().max(120).nullable().optional(),
  roles: z.array(z.enum(UK_ROLES)).min(1, 'Оставьте хотя бы одну роль').optional(),
  isActive: z.boolean().optional(),
});

interface StaffRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  position: string | null;
  is_active: boolean;
  roles: string[] | null;
}

function toStaff(row: StaffRow) {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    position: row.position,
    isActive: row.is_active,
    roles: row.roles ?? [],
  };
}

async function listStaff(tenantId: string): Promise<ReturnType<typeof toStaff>[]> {
  const res = await pool.query<StaffRow>(
    `SELECT u.id, u.full_name, u.phone, u.email, s.position, s.is_active,
            array_remove(array_agg(DISTINCT r.code), NULL) AS roles
       FROM staff s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_roles ur ON ur.user_id = s.user_id AND ur.tenant_id = s.tenant_id
       LEFT JOIN roles r ON r.id = ur.role_id
      WHERE s.tenant_id = $1
        AND u.status = 'active'
        AND u.deleted_at IS NULL
      GROUP BY u.id, u.full_name, u.phone, u.email, s.position, s.is_active
      ORDER BY s.is_active DESC, u.full_name`,
    [tenantId],
  );
  return res.rows.map(toStaff);
}

export async function staffRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    { preHandler: [app.authenticate, app.requirePermission('staff.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      return reply.send({ items: await listStaff(auth.tenantId) });
    },
  );

  app.post(
    '/',
    { preHandler: [app.authenticate, app.requirePermission('staff.roles.assign')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message ?? 'Проверьте данные сотрудника',
        );
      }
      const input = parsed.data;
      const passwordHash = await hashPasswordAsync(input.password);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let userId: string;
        try {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO users (full_name, phone, email, password_hash)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [input.fullName, input.phone, input.email || null, passwordHash],
          );
          userId = inserted.rows[0]!.id;
        } catch (err) {
          await client.query('ROLLBACK');
          if ((err as { code?: string }).code === '23505') {
            return fail(
              request,
              reply,
              409,
              'PHONE_OR_EMAIL_BUSY',
              'Пользователь с таким телефоном или e-mail уже существует',
            );
          }
          throw err;
        }

        await client.query(
          `INSERT INTO staff (tenant_id, user_id, position) VALUES ($1, $2, $3)`,
          [auth.tenantId, userId, input.position || null],
        );
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, tenant_id, granted_by)
           SELECT $1, id, $2, $3 FROM roles WHERE code = ANY($4::text[])`,
          [userId, auth.tenantId, auth.userId, input.roles],
        );
        await client.query('COMMIT');

        await writeAudit({
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          actorIp: request.ip,
          action: 'staff.create',
          entityType: 'staff',
          entityId: userId,
          after: { fullName: input.fullName, roles: input.roles },
        });
        const items = await listStaff(auth.tenantId);
        return reply.status(201).send(items.find((item) => item.id === userId) ?? null);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate, app.requirePermission('staff.roles.assign')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      const id = z.string().uuid().safeParse(request.params.id);
      if (!id.success) return fail(request, reply, 404, 'NOT_FOUND', 'Сотрудник не найден');
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message ?? 'Проверьте данные',
        );
      }
      if (id.data === auth.userId && parsed.data.isActive === false) {
        return fail(request, reply, 400, 'SELF_DEACTIVATE', 'Нельзя деактивировать себя');
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const exists = await client.query(
          `SELECT 1 FROM staff WHERE tenant_id = $1 AND user_id = $2`,
          [auth.tenantId, id.data],
        );
        if ((exists.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          return fail(request, reply, 404, 'NOT_FOUND', 'Сотрудник не найден');
        }

        if (parsed.data.fullName !== undefined) {
          await client.query('UPDATE users SET full_name = $2 WHERE id = $1', [
            id.data,
            parsed.data.fullName,
          ]);
        }
        if (parsed.data.position !== undefined) {
          await client.query('UPDATE staff SET position = $3 WHERE tenant_id = $1 AND user_id = $2', [
            auth.tenantId,
            id.data,
            parsed.data.position || null,
          ]);
        }
        if (parsed.data.isActive !== undefined) {
          await client.query(
            'UPDATE staff SET is_active = $3 WHERE tenant_id = $1 AND user_id = $2',
            [auth.tenantId, id.data, parsed.data.isActive],
          );
          await client.query(
            'UPDATE users SET status = $2 WHERE id = $1',
            [id.data, parsed.data.isActive ? 'active' : 'blocked'],
          );
        }
        if (parsed.data.roles) {
          await client.query(
            `DELETE FROM user_roles
              WHERE user_id = $1 AND tenant_id = $2
                AND role_id IN (SELECT id FROM roles WHERE code = ANY($3::text[]))`,
            [id.data, auth.tenantId, UK_ROLES],
          );
          if (parsed.data.isActive !== false) {
            await client.query(
              `INSERT INTO user_roles (user_id, role_id, tenant_id, granted_by)
               SELECT $1, id, $2, $3 FROM roles WHERE code = ANY($4::text[])
               ON CONFLICT DO NOTHING`,
              [id.data, auth.tenantId, auth.userId, parsed.data.roles],
            );
          }
        }
        await client.query('COMMIT');

        await writeAudit({
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          actorIp: request.ip,
          action: 'staff.update',
          entityType: 'staff',
          entityId: id.data,
          after: parsed.data,
        });
        const items = await listStaff(auth.tenantId);
        return reply.send(items.find((item) => item.id === id.data) ?? null);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
