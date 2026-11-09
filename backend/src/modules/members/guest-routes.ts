/**
 * Гостевой доступ по коду.
 *
 * Отдельный набор маршрутов, а не «урезанный пользователь»: у гостя нет
 * учётной записи, ролей, прав платформы и персональных данных. Если выдать
 * ему обычный токен, половина API отвечала бы 403 в непредсказуемых местах.
 *
 * Сессия — JWT с типом `guest` и идентификатором членства. Права читаются
 * из записи членства при каждом запросе, поэтому отзыв доступа действует
 * немедленно, а не после истечения токена.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { writeAudit } from '../auth/service.js';
import { guestListPoints, guestOpenPoint } from '../access/service.js';
import { hasAnyAccessScope } from './service.js';
import { authenticateByCode, getGuestContext, type GuestContext } from './code-access.js';

interface GuestTokenPayload {
  sub: string;
  type: 'guest';
}

/**
 * Гостю не нужен короткий токен: он не делает ничего опасного, кроме
 * открытия двери. Права всё равно перечитываются с каждым запросом.
 */
const GUEST_TOKEN_TTL = '30d';

/** Сколько попыток ввода кода разрешаем с одного адреса. */
const LOGIN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

async function requireGuest(request: {
  jwtVerify: <T>() => Promise<T>;
}): Promise<GuestContext | null> {
  try {
    const payload = await request.jwtVerify<GuestTokenPayload>();
    if (payload.type !== 'guest' || !payload.sub) return null;
    const guest = await getGuestContext(payload.sub);
    return guest && guest.isActive ? guest : null;
  } catch {
    return null;
  }
}

export async function guestRoutes(app: FastifyInstance): Promise<void> {
  // ─── Вход по коду ────────────────────────────────────────────────────────
  app.post<{ Body: { code?: string } }>(
    '/login',
    { config: { rateLimit: LOGIN_RATE_LIMIT } },
    async (request, reply) => {
      const parsed = z.object({ code: z.string().trim().min(4).max(20) }).safeParse(request.body);
      if (!parsed.success) {
        return fail(request, reply, 400, 'VALIDATION_ERROR', 'Введите код доступа');
      }

      const guest = await authenticateByCode(parsed.data.code);
      if (!guest || !guest.isActive) {
        // Один и тот же ответ на «нет кода», «истёк» и «отозван»: не
        // подсказываем, какие коды существуют
        await writeAudit({
          actorIp: request.ip,
          action: 'guest.failed',
          after: { codeLength: parsed.data.code.length },
        });
        return fail(request, reply, 401, 'INVALID_CODE', 'Код не подошёл или истёк');
      }

      const token = app.jwt.sign({ sub: guest.memberId, type: 'guest' } as GuestTokenPayload, {
        expiresIn: GUEST_TOKEN_TTL,
      });

      await writeAudit({
        actorIp: request.ip,
        action: 'guest.login',
        entityType: 'apartment_member',
        entityId: guest.memberId,
      });

      return reply.send({ token, guest: publicGuest(guest) });
    },
  );

  // ─── Кто я ───────────────────────────────────────────────────────────────
  app.get('/me', async (request, reply) => {
    const guest = await requireGuest(request);
    if (!guest) return fail(request, reply, 401, 'ACCESS_REVOKED', 'Доступ отозван или истёк');
    return reply.send({ guest: publicGuest(guest) });
  });

  // ─── Точки доступа ───────────────────────────────────────────────────────
  app.get('/points', async (request, reply) => {
    const guest = await requireGuest(request);
    if (!guest) return fail(request, reply, 401, 'ACCESS_REVOKED', 'Доступ отозван или истёк');

    if (!hasAnyAccessScope(guest.scopes)) return reply.send({ items: [] });

    const items = await guestListPoints(guest.apartmentId, guest.scopes);
    return reply.send({ items });
  });

  // ─── Открыть точку ───────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/points/:id/open', async (request, reply) => {
    const guest = await requireGuest(request);
    if (!guest) return fail(request, reply, 401, 'ACCESS_REVOKED', 'Доступ отозван или истёк');

    if (!hasAnyAccessScope(guest.scopes)) {
      return fail(request, reply, 403, 'FORBIDDEN', 'Этому коду открывать двери нельзя');
    }

    const idParsed = z.string().uuid().safeParse(request.params.id);
    if (!idParsed.success) {
      return fail(request, reply, 404, 'NOT_FOUND', 'Точка доступа не найдена');
    }

    const outcome = await guestOpenPoint(
      guest.apartmentId,
      idParsed.data,
      guest.memberId,
      guest.scopes,
    );
    if (!outcome.ok) {
      return fail(request, reply, outcome.status, outcome.code, outcome.message);
    }

    return reply.send({
      message: outcome.message,
      holdSeconds: outcome.holdSeconds ?? null,
      openedAt: outcome.openedAt,
    });
  });
}

/**
 * Что показываем гостю: адрес, срок и права.
 *
 * Метку (label) не отдаём: владелец мог подписать доступ как угодно
 * («Балбес», «Какой-то хрен»), и человек увидит это на своём экране.
 * Метка нужна только владельцу — для порядка в его списке.
 */
function publicGuest(guest: GuestContext) {
  return {
    memberId: guest.memberId,
    addressText: guest.addressText,
    apartmentNumber: guest.apartmentNumber,
    tenantName: guest.tenantName,
    scopes: guest.scopes,
    expiresAt: guest.expiresAt,
  };
}
