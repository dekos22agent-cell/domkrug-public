/**
 * Служебные маршруты для инфраструктуры.
 *
 * Caddy с `on_demand_tls` спрашивает этот endpoint ПЕРЕД выпуском
 * сертификата на `<slug>.liviti.ru`. Проверка обязательна: без неё любой
 * желающий получил бы валидный сертификат Let's Encrypt на произвольный
 * поддомен нашего домена — и мог бы выдать себя за УК.
 *
 * Endpoint публичный: Caddy не умеет ходить с токеном. Секретов он не
 * отдаёт — только «да/нет» по уже публичному адресу УК.
 */
import type { FastifyInstance } from 'fastify';
import { fail } from '../../lib/http.js';
import { pool } from '../../db/pool.js';

const TENANT_HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const SUFFIX = '.liviti.ru';
/**
 * Служебные хосты, которые обслуживает тот же Caddy. Им сертификат нужен,
 * поэтому on-demand-валидатор их разрешает: это наши адреса, не чужие.
 */
const SERVICE_HOSTS = new Set(['app', 'uk', 'www']);
/** Зарезервированные имена, которым сертификат не выдаём. */
const DENIED_HOSTS = new Set(['api', 'mail', 'ftp']);

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tls/allow', async (request, reply) => {
    const raw = String((request.query as { domain?: string }).domain ?? '');
    // Caddy присылает домен без порта, но на всякий случай снимаем его
    const domain = raw.trim().toLowerCase().replace(/:\d+$/, '');

    if (!domain.endsWith(SUFFIX)) {
      return fail(request, reply, 403, 'DOMAIN_NOT_ALLOWED', 'Домен не относится к liviti.ru');
    }

    const slug = domain.slice(0, -SUFFIX.length);
    if (!TENANT_HOST_RE.test(slug) || DENIED_HOSTS.has(slug)) {
      return fail(request, reply, 403, 'DOMAIN_NOT_ALLOWED', 'Поддомен не закреплён за УК');
    }

    // app/uk/www — наши служебные адреса; они тоже живут в wildcard-блоке
    if (SERVICE_HOSTS.has(slug)) {
      return reply.send({ allowed: true, slug, service: true });
    }

    const res = await pool.query(
      `SELECT 1 FROM tenants
        WHERE slug = $1 AND status = 'active' AND deleted_at IS NULL
        LIMIT 1`,
      [slug],
    );
    if ((res.rowCount ?? 0) === 0) {
      return fail(request, reply, 403, 'DOMAIN_NOT_ALLOWED', 'УК с таким поддоменом не найдена');
    }

    return reply.send({ allowed: true, slug });
  });
}
