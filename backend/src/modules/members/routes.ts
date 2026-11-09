
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { writeAudit } from '../auth/service.js';
import {
  PRESET_SCOPES,
  PRESETS_REQUIRING_EXPIRY,
  canManageMembers,
  confirmMember,
  inviteMember,
  listMembers,
  revokeMember,
  type MemberPreset,
} from './service.js';
import { createCodeAccess } from './code-access.js';

/**
 * Допустимые права. Список закрытый: клиент не должен придумывать
 * произвольные строки, которые потом никто не проверяет.
 */
const SCOPE_VALUES = [
  'access.open',
  'access.entrance_door',
  'access.wicket',
  'access.barrier',
  'access.gate',
  'access.parking',
  'video.view',
  'meters.submit',
  'tickets.create',
  'finance.view',
  'members.manage',
] as const;

const scopesSchema = z.array(z.enum(SCOPE_VALUES)).max(10).optional();

const inviteSchema = z.object({
  apartmentId: z.string().uuid(),
  phone: z.string().trim().min(10).max(20),
  preset: z.enum(['family', 'child', 'tenant', 'worker', 'guest']),
  /** Чекбоксы «что разрешено»; если пусто — берём набор пресета. */
  scopes: scopesSchema,
  /** Для рабочего и гостя обязателен: ISO-дата или YYYY-MM-DD */
  expiresAt: z.string().trim().max(40).optional(),
});

export async function residentMemberRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { apartmentId?: string } }>(
    '/',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const apartmentId = request.query.apartmentId;
      const parsed = z.string().uuid().safeParse(apartmentId);
      if (!parsed.success) {
        return fail(request, reply, 400, 'VALIDATION_ERROR', 'Укажите квартиру');
      }

      const items = await listMembers(auth.userId, parsed.data);
      if (items === null) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет права управлять членами этой квартиры');
      }
      return reply.send({ items });
    },
  );

  app.post('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const input = inviteSchema.parse(request.body);
    const outcome = await inviteMember({
      ownerUserId: auth.userId,
      apartmentId: input.apartmentId,
      phone: input.phone,
      preset: input.preset,
      scopes: input.scopes,
      expiresAt: input.expiresAt ? `${input.expiresAt}T23:59:59+07:00` : null,
    });

    if (!outcome.ok) {
      return fail(request, reply, outcome.status, outcome.code, outcome.message);
    }

    await writeAudit({
      actorUserId: auth.userId,
      actorIp: request.ip,
      action: 'member.invite',
      entityType: 'apartment_member',
      entityId: outcome.member.id,
      after: { preset: input.preset, scopes: input.scopes ?? null, expiresAt: input.expiresAt ?? null },
    });

    return reply.status(201).send({
      member: outcome.member,
      // true только если доступ уже был активен (повторное приглашение)
      activated: outcome.activated,
    });
  });

  // Подтверждение приглашённого: без него доступ по телефону не включается
  app.post<{ Params: { id: string } }>(
    '/:id/confirm',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      const bodyParsed = z.object({ apartmentId: z.string().uuid() }).safeParse(request.body);
      if (!idParsed.success || !bodyParsed.success) {
        return fail(request, reply, 400, 'VALIDATION_ERROR', 'Укажите квартиру');
      }

      if (!(await canManageMembers(auth.userId, bodyParsed.data.apartmentId))) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет права управлять членами этой квартиры');
      }

      const done = await confirmMember(
        auth.userId,
        bodyParsed.data.apartmentId,
        idParsed.data,
      );
      if (!done) {
        return fail(
          request,
          reply,
          409,
          'NOT_READY',
          'Приглашение не найдено или человек ещё не зарегистрировался',
        );
      }

      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'member.confirm',
        entityType: 'apartment_member',
        entityId: idParsed.data,
        after: { apartmentId: bodyParsed.data.apartmentId },
      });

      return reply.send({ status: 'active' });
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { apartmentId?: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      const apartmentParsed = z.string().uuid().safeParse(request.query.apartmentId);
      if (!idParsed.success || !apartmentParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Приглашение не найдено');
      }

      const done = await revokeMember(auth.userId, apartmentParsed.data, idParsed.data);
      if (!done) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Приглашение не найдено или уже отозвано');
      }

      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'member.revoke',
        entityType: 'apartment_member',
        entityId: idParsed.data,
      });

      return reply.status(204).send();
    },
  );
  /**
   * Доступ по коду: без регистрации и без персональных данных.
   *
   * Владелец задаёт, что будет доступно и на какой срок; человек вводит код
   * на экране входа. Код показываем один раз — в базе только хеш, поэтому
   * потерянный код не восстановить, можно только выпустить новый.
   */
  app.post('/code', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const parsed = z
      .object({
        apartmentId: z.string().uuid(),
        preset: z.enum(['family', 'child', 'tenant', 'worker', 'guest']),
        scopes: scopesSchema,
        label: z.string().trim().min(1).max(60),
        expiresAt: z.string().trim().max(40).optional(),
      })
      .safeParse(request.body);

    if (!parsed.success) {
      return fail(request, reply, 400, 'VALIDATION_ERROR', 'Укажите квартиру, назначение и срок');
    }

    const input = parsed.data;
    if (!(await canManageMembers(auth.userId, input.apartmentId))) {
      return fail(request, reply, 403, 'FORBIDDEN', 'Нет права выдавать доступ в эту квартиру');
    }

    const preset = input.preset as MemberPreset;
    if (PRESETS_REQUIRING_EXPIRY.includes(preset) && !input.expiresAt) {
      return fail(request, reply, 400, 'EXPIRY_REQUIRED', 'Для рабочего и гостя укажите срок');
    }

    // Чекбоксы интерфейса важнее пресета
    const scopes =
      input.scopes && input.scopes.length > 0 ? input.scopes : PRESET_SCOPES[preset];

    const issued = await createCodeAccess({
      ownerUserId: auth.userId,
      apartmentId: input.apartmentId,
      preset,
      scopes,
      label: input.label,
      expiresAt: input.expiresAt ? `${input.expiresAt}T23:59:59+07:00` : null,
    });

    if (!issued) return fail(request, reply, 400, 'ERROR', 'Не удалось создать код');

    await writeAudit({
      actorUserId: auth.userId,
      actorIp: request.ip,
      action: 'member.code_create',
      entityType: 'apartment_member',
      entityId: issued.memberId,
      after: { preset, scopes, expiresAt: input.expiresAt ?? null },
    });

    return reply.status(201).send({
      memberId: issued.memberId,
      code: issued.code,
      prefix: issued.prefix,
    });
  });
}
