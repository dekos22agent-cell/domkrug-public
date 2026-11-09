/**
 * Маршруты авторизации.
 *
 * Модель токенов:
 *   access  — JWT, 15 минут, в заголовке Authorization, в памяти клиента;
 *   refresh — случайная строка (не JWT), 30 дней, httpOnly cookie,
 *             хранится в БД в виде sha256-хеша и ротируется при каждом обновлении.
 *
 * Почему refresh — не JWT: его нужно отзывать, а отзыв требует состояния
 * на сервере. Опаковая строка проще и честнее: одна запись = одна сессия.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config.js';
import { fail } from '../../lib/http.js';
import { hashPassword, hashPasswordAsync, verifyPasswordAsync } from '../../lib/password.js';
import { parseDuration } from '../../lib/time.js';
import { scaledLimit } from '../../lib/limits.js';
import { query } from '../../db/pool.js';
import { normalizeSnils, validateSnils } from '../../lib/snils.js';
import { claimInvites, listMemberships } from '../members/service.js';
import { changePasswordSchema, loginSchema, registerSchema, updateProfileSchema } from './schemas.js';
import {
  claimSessionForRefresh,
  createResident,
  createSession,
  findSessionById,
  findSessionByToken,
  findUserById,
  findUserByIdentifier,
  generateRefreshTokenValue,
  getAccessContext,
  getBindings,
  revokeAllUserSessions,
  revokeSession,
  updateUserProfile,
  writeAudit,
  type UserRow,
} from './service.js';
import { checkSecondFactor, getTwoFactorState } from './two-factor-service.js';

const REFRESH_COOKIE = 'refresh_token';

/**
 * Фиктивный хеш для выравнивания времени ответа.
 *
 * Для несуществующего пользователя мы не считаем scrypt, и ответ приходит
 * быстрее, чем на неверный пароль. Проверяем присланный пароль против
 * фиктивного хеша, чтобы по задержке нельзя было перечислять телефоны.
 */
const DUMMY_PASSWORD_HASH = hashPassword('timing-equalizer-not-a-real-account');

/** Cookie настроена так, что JS её не видит и она не уходит на чужие сайты. */
function refreshCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict';
  path: string;
  maxAge: number;
  domain?: string;
} {
  return {
    httpOnly: true,
    // false допускается только осознанно: см. COOKIE_SECURE в config.ts
    secure: config.cookieSecure,
    sameSite: 'strict',
    // Только на маршруты авторизации: остальным API refresh не нужен
    path: '/api/v1/auth',
    maxAge: Math.floor(parseDuration(config.jwt.refreshTtl) / 1000),
    // В production — `.liviti.ru`: иначе главная страница на liviti.ru
    // не увидит сессию, открытую на app./uk.
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
}

/** Параметры удаления cookie: домен должен совпадать с тем, на котором ставили. */
function refreshCookieClearOptions(): { path: string; domain?: string } {
  return {
    path: '/api/v1/auth',
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
}

/**
 * Поставить refresh-cookie, убрав возможную старую host-only.
 *
 * До появления COOKIE_DOMAIN cookie была привязана к конкретному хосту.
 * После перехода на `.liviti.ru` в браузере могут оказаться ДВЕ cookie
 * с одним именем и путём: старая host-only и новая доменная. Браузер
 * отправляет обе, и сервер может прочитать устаревшую — тогда после
 * перезагрузки сессия «пропадает». Чистим host-only перед установкой.
 */
function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  reply.setCookie(REFRESH_COOKIE, token, refreshCookieOptions());
}

/** Удалить refresh-cookie в обоих вариантах: host-only и доменном. */
function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  if (config.cookieDomain) {
    reply.clearCookie(REFRESH_COOKIE, refreshCookieClearOptions());
  }
}

/** Ротация была меньше 5 секунд назад — вероятно, вторая вкладка, а не кража. */
function isRecentRotation(revokedAt: Date | null): boolean {
  return Boolean(revokedAt && Date.now() - revokedAt.getTime() < 5000);
}

function publicUser(user: UserRow): {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  snils: string | null;
} {
  return {
    id: user.id,
    fullName: user.full_name,
    phone: user.phone,
    email: user.email,
    birthDate: user.birth_date,
    snils: user.snils,
  };
}

/**
 * Выдаёт пару токенов и создаёт сессию.
 * Возвращает данные для ответа; cookie ставит вызывающий.
 */
async function issueSession(
  app: FastifyInstance,
  user: UserRow,
  request: FastifyRequest,
): Promise<{ accessToken: string; refreshToken: string; accessExpiresIn: number }> {
  const { staffTenant } = await getAccessContext(user.id);
  const tenantId = staffTenant?.tenantId ?? null;

  const accessToken = app.jwt.sign(
    // jti делает каждый токен уникальным: без него два входа подряд
    // в одну секунду дают побайтово одинаковый JWT (одинаковый iat),
    // и клиент не может отличить новый токен от старого
    { sub: user.id, tid: tenantId, typ: 'access', jti: randomUUID() },
    { expiresIn: config.jwt.accessTtl },
  );

  // Refresh-токен — случайная строка, а не JWT: его нужно отзывать,
  // а отзыв требует состояния на сервере (таблица sessions).
  const refreshToken = generateRefreshTokenValue();

  const expiresAt = new Date(Date.now() + parseDuration(config.jwt.refreshTtl));
  await createSession({
    userId: user.id,
    token: refreshToken,
    expiresAt,
    userAgent: request.headers['user-agent'],
    ip: request.ip,
  });

  return {
    accessToken,
    refreshToken,
    accessExpiresIn: Math.floor(parseDuration(config.jwt.accessTtl) / 1000),
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ─── Регистрация жителя ───────────────────────────────────────────────────
  app.post(
    '/register',
    {
      config: {
        // Отдельный лимит: регистрация — точка, куда бьют боты
        rateLimit: { max: scaledLimit(5), timeWindow: '1 hour' },
      },
    },
    async (request, reply) => {
      const input = registerSchema.parse(request.body);
      const passwordHash = await hashPasswordAsync(input.password);

      let userId: string;
      try {
        const created = await createResident({
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          passwordHash,
        });
        userId = created.id;
      } catch (err) {
        const pgErr = err as { code?: string; constraint?: string };
        if (pgErr.code === '23505') {
          const field = pgErr.constraint?.includes('email') ? 'e-mail' : 'телефон';
          return fail(request, reply, 409, 'ALREADY_EXISTS', `Этот ${field} уже зарегистрирован`);
        }
        throw err;
      }

      const user = await findUserById(userId);
      if (!user) return fail(request, reply, 500, 'INTERNAL', 'Пользователь не создан');

      // Приглашение по телефону подхватываем сразу после регистрации:
      // человек не должен выходить и входить снова, чтобы увидеть квартиру
      if (input.phone) {
        await claimInvites(user.id, input.phone);
      }

      // Факт согласия на обработку ПДн фиксируется в аудите (152-ФЗ)
      await writeAudit({
        actorUserId: user.id,
        actorIp: request.ip,
        action: 'auth.register',
        entityType: 'user',
        entityId: user.id,
        after: { consentAccepted: true, consentVersion: '1.0' },
      });

      const session = await issueSession(app, user, request);
      setRefreshCookie(reply, session.refreshToken);

      return reply.status(201).send({
        user: publicUser(user),
        // Привязки к квартире ещё нет — интерфейс попросит указать адрес
        requiresBinding: true,
        accessToken: session.accessToken,
        tokenType: 'Bearer',
        expiresIn: session.accessExpiresIn,
      });
    },
  );

  // ─── Вход ─────────────────────────────────────────────────────────────────
  app.post(
    '/login',
    {
      config: {
        rateLimit: { max: scaledLimit(10), timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const user = await findUserByIdentifier(input.identifier);

      // Одинаковый ответ для «нет такого» и «неверный пароль»:
      // иначе можно перебором узнать, кто зарегистрирован
      const invalid = (): FastifyReply =>
        fail(request, reply, 401, 'INVALID_CREDENTIALS', 'Неверный телефон/e-mail или пароль');

      if (!user) {
        // Выравниваем время ответа с ветвью «неверный пароль»
        await verifyPasswordAsync(input.password, DUMMY_PASSWORD_HASH);
        await writeAudit({
          actorIp: request.ip,
          action: 'auth.failed',
          after: { identifier: input.identifier },
        });
        return invalid();
      }

      if (user.status !== 'active') {
        await writeAudit({
          actorUserId: user.id,
          actorIp: request.ip,
          action: 'auth.failed',
          after: { reason: 'account_not_active' },
        });
        return invalid();
      }

      if (!(await verifyPasswordAsync(input.password, user.password_hash))) {
        await writeAudit({
          actorUserId: user.id,
          actorIp: request.ip,
          action: 'auth.failed',
          after: { reason: 'bad_password' },
        });
        return invalid();
      }

      // Пароль верный, но вход не в то приложение. Ответ тот же, что и на
      // неверный пароль: клиент не должен узнать, что учётка существует и
      // работает в другой роли. Настоящая причина остаётся в аудите.
      const access = await getAccessContext(user.id);
      const staffRoles = ['uk_admin', 'dispatcher', 'uk_manager', 'executor', 'platform_admin'];
      const isStaffAccount = access.roles.some((role) => staffRoles.includes(role));
      const isResidentAccount = access.roles.includes('resident');
      const wrongApp =
        (input.audience === 'staff' && !isStaffAccount) ||
        (input.audience === 'resident' && !isResidentAccount);

      if (wrongApp) {
        await writeAudit({
          actorUserId: user.id,
          actorIp: request.ip,
          action: 'auth.failed',
          after: { reason: 'wrong_app', audience: input.audience },
        });
        return invalid();
      }

      // Второй фактор проверяется после пароля и приложения: до этого
      // человек ещё не доказал, что он владелец учётки. Ответ TOTP_REQUIRED
      // не раскрывает ничего нового — пароль уже верный.
      const secondFactor = await checkSecondFactor(user, {
        totpCode: input.totpCode,
        backupCode: input.backupCode,
      });
      if (secondFactor.ok === false) {
        await writeAudit({
          actorUserId: user.id,
          actorIp: request.ip,
          action: 'auth.failed',
          after: {
            reason: secondFactor.reason === 'required' ? 'totp_required' : 'bad_totp',
          },
        });
        if (secondFactor.reason === 'required') {
          return fail(
            request,
            reply,
            401,
            'TOTP_REQUIRED',
            'Введите код из приложения-аутентификатора',
          );
        }
        return fail(request, reply, 401, 'INVALID_TOTP', 'Неверный код подтверждения');
      }

      // Приглашения активируем только после пароля и второго фактора:
      // до этого человек не доказал владение учёткой, и выдавать права нельзя.
      if (user.phone) {
        await claimInvites(user.id, user.phone);
      }

      const session = await issueSession(app, user, request);
      setRefreshCookie(reply, session.refreshToken);

      await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
      await writeAudit({
        actorUserId: user.id,
        actorIp: request.ip,
        action: 'auth.login',
        after: { twoFactor: secondFactor.method ?? 'none' },
      });

      const { roles, staffTenant } = access;

      return reply.send({
        user: publicUser(user),
        roles,
        tenant: staffTenant
          ? { id: staffTenant.tenantId, name: staffTenant.tenantName }
          : null,
        accessToken: session.accessToken,
        tokenType: 'Bearer',
        expiresIn: session.accessExpiresIn,
      });
    },
  );

  // ─── Обновление токенов ───────────────────────────────────────────────────
  app.post('/refresh', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) {
      return fail(request, reply, 401, 'UNAUTHORIZED', 'Нет refresh-токена');
    }

    const session = await findSessionByToken(token);
    if (!session) {
      clearRefreshCookie(reply);
      return fail(request, reply, 401, 'UNAUTHORIZED', 'Сессия не найдена, войдите заново');
    }

    // Повторное использование отозванного токена — признак кражи.
    // Ротация уже прошла, значит этот токен у кого-то «лишнего»:
    // закрываем ВСЕ сессии пользователя.
    if (session.revoked_at) {
      const recent = isRecentRotation(session.revoked_at);
      if (!recent) await revokeAllUserSessions(session.user_id);
      clearRefreshCookie(reply);
      return fail(
        request,
        reply,
        401,
        'SESSION_REVOKED',
        recent
          ? 'Сессия уже обновлена в другой вкладке'
          : 'Сессия уже была обновлена. Все сессии закрыты из-за подозрения на кражу токена.',
      );
    }

    if (session.expires_at.getTime() < Date.now()) {
      await revokeSession(session.id);
      clearRefreshCookie(reply);
      return fail(request, reply, 401, 'SESSION_EXPIRED', 'Сессия истекла, войдите заново');
    }

    const user = await findUserById(session.user_id);
    if (!user || user.status !== 'active') {
      await revokeSession(session.id);
      clearRefreshCookie(reply);
      return fail(request, reply, 401, 'UNAUTHORIZED', 'Доступ закрыт');
    }

    // Ротация: атомарно забираем старую сессию. Если два запроса пришли
    // одновременно, новую сессию создаст только победитель.
    const claimed = await claimSessionForRefresh(session.id);
    if (!claimed) {
      const latest = await findSessionById(session.id);
      if (latest?.revoked_at) {
        // Недавняя ротация (в пределах 5 секунд) — скорее две вкладки,
        // чем кража: не закрываем сессию победителя. Старый токен старше
        // 5 секунд — признак кражи, закрываем все.
        const recent = isRecentRotation(latest.revoked_at);
        if (!recent) await revokeAllUserSessions(session.user_id);
        clearRefreshCookie(reply);
        return fail(
          request,
          reply,
          401,
          'SESSION_REVOKED',
          recent
            ? 'Сессия уже обновлена в другой вкладке'
            : 'Сессия уже была обновлена. Все сессии закрыты из-за подозрения на кражу токена.',
        );
      }
      clearRefreshCookie(reply);
      return fail(request, reply, 401, 'SESSION_EXPIRED', 'Сессия истекла, войдите заново');
    }

    const newSession = await issueSession(app, user, request);
    setRefreshCookie(reply, newSession.refreshToken);

    return reply.send({
      accessToken: newSession.accessToken,
      tokenType: 'Bearer',
      expiresIn: newSession.accessExpiresIn,
    });
  });

  // ─── Выход ────────────────────────────────────────────────────────────────
  app.post('/logout', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (token) {
      const session = await findSessionByToken(token);
      if (session) {
        await revokeSession(session.id);
        await writeAudit({
          actorUserId: session.user_id,
          actorIp: request.ip,
          action: 'auth.logout',
        });
      }
    }
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  /** Выход со всех устройств: закрывает все refresh-сессии пользователя. */
  app.post(
    '/logout-all',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const revoked = await revokeAllUserSessions(auth.userId);
      clearRefreshCookie(reply);
      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'auth.logout_all',
        after: { sessionsRevoked: revoked },
      });
      return reply.status(204).send();
    },
  );

  // ─── Текущая сессия для главной страницы ─────────────────────────────────
  // Не ротирует refresh-токен: главная может открываться сколько угодно раз,
  // и это не должно выглядеть как «повторное использование» токена.
  app.get('/session', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) return fail(request, reply, 401, 'UNAUTHORIZED', 'Нет сессии');

    const session = await findSessionByToken(token);
    if (!session || session.revoked_at || session.expires_at.getTime() < Date.now()) {
      return fail(request, reply, 401, 'UNAUTHORIZED', 'Сессия недействительна');
    }

    const user = await findUserById(session.user_id);
    if (!user || user.status !== 'active') {
      return fail(request, reply, 401, 'UNAUTHORIZED', 'Доступ закрыт');
    }

    const { roles } = await getAccessContext(user.id);
    return reply.send({ user: publicUser(user), roles });
  });

  // ─── Текущий пользователь ─────────────────────────────────────────────────
  app.get('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const user = await findUserById(auth.userId);
    if (!user) return fail(request, reply, 404, 'NOT_FOUND', 'Пользователь не найден');

    const { staffTenant } = await getAccessContext(user.id);
    const bindings = await getBindings(user.id);
    // Квартиры, куда пригласили: член семьи не собственник, привязки у него
    // нет, но квартира, адрес и права есть — интерфейсу это нужно
    const memberships = await listMemberships(user.id);
    // Состояние второго фактора: профиль показывает «подключён/не подключён»
    // и напоминает, что для диспетчеров и админов он обязателен по политике
    const twoFactor = await getTwoFactorState(user.id, auth.roles);

    return reply.send({
      user: publicUser(user),
      roles: auth.roles,
      permissions: [...auth.permissions].sort(),
      tenant: staffTenant
        ? {
            id: staffTenant.tenantId,
            name: staffTenant.tenantName,
            slug: staffTenant.tenantSlug,
            position: staffTenant.position,
          }
        : null,
      bindings,
      memberships,
      twoFactor,
    });
  });

  // ─── Дозаполнение профиля ─────────────────────────────────────────────────
  app.patch('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const input = updateProfileSchema.parse(request.body);

    // Пустая строка = «стереть значение», а не «оставить как было»
    const patch: Parameters<typeof updateUserProfile>[1] = {};
    if (input.fullName !== undefined) patch.fullName = input.fullName;
    if (input.email !== undefined) patch.email = input.email === '' ? null : input.email;
    if (input.birthDate !== undefined) {
      patch.birthDate = input.birthDate === '' ? null : input.birthDate;
    }
    if (input.snils !== undefined) {
      if (input.snils === '') {
        patch.snils = null;
      } else {
        // Проверяем не только длину, но и контрольную сумму: иначе человек
        // с опечаткой не сможет свериться с реестром УК, и мы будем искать
        // ошибку не там, где она есть.
        const snilsError = validateSnils(input.snils);
        if (snilsError) {
          return fail(request, reply, 400, 'VALIDATION_ERROR', snilsError);
        }
        patch.snils = normalizeSnils(input.snils);
      }
    }

    // Дата рождения не может быть в будущем — проверяем до записи,
    // чтобы вернуть понятную ошибку, а не нарушение ограничения БД.
    if (patch.birthDate) {
      const date = new Date(`${patch.birthDate}T00:00:00Z`);
      if (Number.isNaN(date.getTime()) || date.getTime() > Date.now()) {
        return fail(request, reply, 400, 'VALIDATION_ERROR', 'Дата рождения не может быть в будущем');
      }
    }

    try {
      const updated = await updateUserProfile(auth.userId, patch);
      if (!updated) return fail(request, reply, 404, 'NOT_FOUND', 'Пользователь не найден');

      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'user.profile_update',
        entityType: 'user',
        entityId: auth.userId,
        after: { fields: Object.keys(patch) },
      });

      return reply.send({ user: publicUser(updated) });
    } catch (err) {
      // Уникальность e-mail: понятное сообщение вместо 500
      if ((err as { code?: string }).code === '23505') {
        return fail(request, reply, 409, 'ALREADY_EXISTS', 'Этот e-mail уже используется');
      }
      throw err;
    }
  });

  // ─── Смена пароля ─────────────────────────────────────────────────────────
  app.post(
    '/password/change',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const input = changePasswordSchema.parse(request.body);
      const user = await findUserById(auth.userId);
      if (!user) return fail(request, reply, 404, 'NOT_FOUND', 'Пользователь не найден');

      if (!(await verifyPasswordAsync(input.currentPassword, user.password_hash))) {
        return fail(request, reply, 400, 'INVALID_PASSWORD', 'Текущий пароль неверен');
      }

      await query('UPDATE users SET password_hash = $2 WHERE id = $1', [
        user.id,
        await hashPasswordAsync(input.newPassword),
      ]);

      // Смена пароля закрывает все сессии: если аккаунт увели, это выкинет злоумышленника
      const revoked = await revokeAllUserSessions(user.id);
      clearRefreshCookie(reply);

      await writeAudit({
        actorUserId: user.id,
        actorIp: request.ip,
        action: 'auth.password_change',
        after: { sessionsRevoked: revoked },
      });

      return reply.status(204).send();
    },
  );
}
