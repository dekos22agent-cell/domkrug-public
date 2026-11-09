/**
 * Маршруты второго фактора.
 *
 * Все, кроме входа, требуют активной сессии: настройка TOTP — действие
 * самого пользователя, а не администратора. Сбросить чужой второй фактор
 * администратор УК сможет отдельной функцией позже; прямой доступ к секрету
 * через API не отдаётся никогда.
 */
import type { FastifyInstance } from 'fastify';
import { fail } from '../../lib/http.js';
import { verifyPassword } from '../../lib/password.js';
import { verifyTotp } from '../../lib/totp.js';
import { disableTwoFactorSchema, enableTwoFactorSchema } from './schemas.js';
import { findUserById, writeAudit } from './service.js';
import {
  confirmTotpSetup,
  consumeBackupCode,
  disableTotp,
  getTwoFactorState,
  startTotpSetup,
} from './two-factor-service.js';

export async function twoFactorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/2fa', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    return reply.send(await getTwoFactorState(auth.userId, auth.roles));
  });

  app.post('/2fa/setup', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const user = await findUserById(auth.userId);
    if (!user) return fail(request, reply, 404, 'NOT_FOUND', 'Пользователь не найден');
    if (user.totp_enabled) {
      return fail(request, reply, 409, 'ALREADY_ENABLED', 'Второй фактор уже включён');
    }

    // Подпись в приложении: телефон понятнее почты, если есть и то, и другое
    const account = user.phone ?? user.email ?? user.id;
    const data = await startTotpSetup(user.id, account);

    await writeAudit({
      actorUserId: user.id,
      actorIp: request.ip,
      action: 'auth.two_factor_setup_started',
    });

    return reply.send(data);
  });

  app.post('/2fa/enable', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const input = enableTwoFactorSchema.parse(request.body);
    const result = await confirmTotpSetup(auth.userId, input.code);

    if (result.ok === false) {
      if (result.reason === 'already_enabled') {
        return fail(request, reply, 409, 'ALREADY_ENABLED', 'Второй фактор уже включён');
      }
      if (result.reason === 'not_started') {
        return fail(
          request,
          reply,
          400,
          'SETUP_NOT_STARTED',
          'Сначала получите секрет для приложения-аутентификатора',
        );
      }
      return fail(
        request,
        reply,
        400,
        'INVALID_TOTP',
        'Неверный код. Проверьте время на телефоне и попробуйте следующий код.',
      );
    }

    await writeAudit({
      actorUserId: auth.userId,
      actorIp: request.ip,
      action: 'auth.two_factor_enabled',
      after: { backupCodes: result.backupCodes.length },
    });

    // Резервные коды показываются один раз: в базе только хеши
    return reply.send({ enabled: true, backupCodes: result.backupCodes });
  });

  app.post('/2fa/disable', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const input = disableTwoFactorSchema.parse(request.body);
    const user = await findUserById(auth.userId);
    if (!user) return fail(request, reply, 404, 'NOT_FOUND', 'Пользователь не найден');
    if (!user.totp_enabled) {
      return fail(request, reply, 409, 'NOT_ENABLED', 'Второй фактор не включён');
    }

    if (!verifyPassword(input.password, user.password_hash)) {
      return fail(request, reply, 400, 'INVALID_PASSWORD', 'Пароль неверен');
    }

    // Принимаем и код из приложения, и резервный: телефон мог потеряться
    const totpOk = user.totp_secret ? verifyTotp(user.totp_secret, input.code) : false;
    const backupOk = totpOk ? false : await consumeBackupCode(user.id, input.code);
    if (!totpOk && !backupOk) {
      return fail(request, reply, 400, 'INVALID_TOTP', 'Неверный код подтверждения');
    }

    await disableTotp(user.id);
    await writeAudit({
      actorUserId: user.id,
      actorIp: request.ip,
      action: 'auth.two_factor_disabled',
    });

    return reply.status(204).send();
  });
}
