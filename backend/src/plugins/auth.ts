/**
 * Проверка авторизации и прав.
 *
 * Два разных механизма, и их нельзя смешивать:
 *   authenticate       — «кто ты»: проверяет access-токен и подгружает контекст;
 *   requirePermission  — «что тебе можно»: проверяет наличие права.
 *
 * Ограничение по строкам (своя УК, своя заявка) — не здесь, а в репозиториях:
 * право отвечает «что можно», область данных — «над какими строками».
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fail } from '../lib/http.js';
import { findUserById, getAccessContext, getPermissions } from '../modules/auth/service.js';

export interface AuthContext {
  userId: string;
  /** УК, к которой пользователь привязан как сотрудник. NULL для жителя. */
  tenantId: string | null;
  roles: string[];
  permissions: Set<string>;
}

export interface AccessTokenPayload {
  sub: string;
  tid: string | null;
  typ: 'access';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      code: string,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function registerAuthGuards(app: FastifyInstance): void {
  app.decorateRequest('auth', null);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      return;
    }

    let payload: AccessTokenPayload;
    try {
      payload = await request.jwtVerify<AccessTokenPayload>();
    } catch {
      // Не различаем «истёк» и «подделан»: клиенту это не нужно, а лишняя
      // информация помогает атакующему понять, что токен был валидным
      fail(request, reply, 401, 'UNAUTHORIZED', 'Сессия истекла или токен недействителен');
      return;
    }

    if (payload.typ !== 'access' || !payload.sub) {
      fail(request, reply, 401, 'UNAUTHORIZED', 'Неверный тип токена');
      return;
    }

    // Пользователь загружается из БД, а не берётся из токена: блокировка
    // или удаление должны действовать немедленно, даже с живым токеном
    const user = await findUserById(payload.sub);
    if (!user || user.status !== 'active') {
      fail(request, reply, 401, 'UNAUTHORIZED', 'Доступ закрыт');
      return;
    }

    const { roles, staffTenant } = await getAccessContext(user.id);
    // УК берётся из БД, а не из токена: если сотрудника перевели в другую УК
    // или уволили, старый токен не должен сохранять прежние права
    const tenantId = staffTenant?.tenantId ?? null;
    const permissions = await getPermissions(user.id, tenantId);

    request.auth = {
      userId: user.id,
      tenantId,
      roles,
      permissions: new Set(permissions),
    };
  });

  app.decorate(
    'requirePermission',
    (code: string) => async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth;
      if (!auth) {
        fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');
        return;
      }
      if (!auth.permissions.has(code)) {
        fail(request, reply, 403, 'FORBIDDEN', 'Недостаточно прав для этого действия');
      }
    },
  );
}
