/**
 * Публичные справочники без авторизации.
 *
 * Зачем: сотрудник открывает `dom-service.liviti.ru` — форма входа должна
 * показать, что это кабинет конкретной УК, а не безликий «кабинет УК».
 * Ничего чувствительного здесь нет: название организации и так публично.
 */
import type { FastifyInstance } from 'fastify';
import { fail } from '../../lib/http.js';
import { pool } from '../../db/pool.js';

const SLUG_RE = /^[a-z0-9-]{2,40}$/;

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tenant', async (request, reply) => {
    const slug = String((request.query as { slug?: string }).slug ?? '')
      .trim()
      .toLowerCase();

    if (!SLUG_RE.test(slug)) {
      return fail(request, reply, 400, 'VALIDATION_ERROR', 'Некорректный поддомен');
    }

    const res = await pool.query<{ slug: string; name: string }>(
      `SELECT slug, name FROM tenants
        WHERE slug = $1 AND status = 'active' AND deleted_at IS NULL
        LIMIT 1`,
      [slug],
    );
    const row = res.rows[0];
    if (!row) {
      return fail(request, reply, 404, 'NOT_FOUND', 'Управляющая компания не найдена');
    }

    return reply.send({ slug: row.slug, name: row.name });
  });
}
