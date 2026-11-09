/**
 * Маршруты камер и видеозвонков жителя.
 *
 * Отдельно от `access`: просмотр видео и открытие двери — разные права
 * и разные риски. Смешивать их в одном наборе маршрутов значило бы
 * однажды случайно выдать видео тому, кому разрешено только открывать.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { config } from '../../config.js';
import { writeAudit } from '../auth/service.js';
import { openAccessPoint } from '../access/service.js';
import {
  finishCall,
  getActiveCall,
  listIntercomCallsForUser,
  getCameraStream,
  listCamerasForUser,
  pointOfCall,
  startDemoCall,
} from './service.js';
import { hangupCall } from '../intercom/service.js';

export async function residentVideoRoutes(app: FastifyInstance): Promise<void> {
  // ─── Камеры жителя ───────────────────────────────────────────────────────
  app.get('/cameras', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const items = await listCamerasForUser(auth.userId);
    return reply.send({ items });
  });

  // ─── Учётка для звонка из браузера (WebRTC) ──────────────────────────────
  /**
   * Отдаём жителю параметры SIP-регистрации, чтобы браузер мог поднять звук.
   *
   * Почему через сервер, а не в клиентской сборке: пароль не должен лежать в
   * JS-бандле, который скачивает любой желающий. Здесь он выдаётся только
   * после проверки токена.
   *
   * Ограничение стенда: абонент один на всех (100). На боевом объекте нужен
   * отдельный абонент на квартиру — иначе два жителя будут выбивать друг
   * друга с регистрации.
   */
  app.get('/sip', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    return reply.send({
      enabled: config.sip.enabled,
      wss: config.sip.wss,
      user: config.sip.user,
      password: config.sip.enabled ? config.sip.password : null,
      realm: config.sip.realm,
    });
  });

  // ─── Ссылка на поток ─────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/cameras/:id/stream',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Камера не найдена');
      }

      const stream = await getCameraStream(auth.userId, idParsed.data);
      if (!stream) {
        // Нет камеры или нет права — одинаковый ответ
        return fail(request, reply, 404, 'NOT_FOUND', 'Камера не найдена');
      }

      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'video.stream_open',
        entityType: 'camera',
        entityId: idParsed.data,
        after: { type: stream.type, demo: stream.demo },
      });

      return reply.send(stream);
    },
  );

  // ─── История звонков ─────────────────────────────────────────────────────
  // Житель видит, что звонили, пока его не было: пропущенный вызов не должен
  // исчезать бесследно. Данные пишутся с 06.11, читать их раньше было нечем.
  app.get<{ Querystring: { limit?: string } }>(
    '/intercom/history',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const parsed = z.coerce.number().int().positive().max(50).default(10).safeParse(
        request.query.limit ?? 10,
      );
      if (!parsed.success) {
        return fail(request, reply, 400, 'VALIDATION_ERROR', 'Некорректный лимит');
      }

      const items = await listIntercomCallsForUser(auth.userId, parsed.data);
      return reply.send({ items });
    },
  );

  // ─── Активный звонок в домофон ───────────────────────────────────────────
  app.get('/intercom/active', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const call = await getActiveCall(auth.userId);
    return reply.send({ call });
  });

  // ─── Демонстрационный звонок ─────────────────────────────────────────────
  // В реальной жизни звонок создаёт устройство через вебхук провайдера.
  // Пока вебхука нет, кнопка позволяет проверить весь сценарий на телефоне.
  app.post<{ Body: { apartmentId?: string } | undefined }>(
    '/intercom/demo-call',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
    const auth = request.auth;
    if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

    const apartmentId = request.body?.apartmentId;
    const call = await startDemoCall(
      auth.userId,
      typeof apartmentId === 'string' ? apartmentId : undefined,
    );
    if (!call) {
      return fail(
        request,
        reply,
        404,
        'NOT_FOUND',
        'Нет доступной вызывной панели: нужна подтверждённая привязка и точка с камерой',
      );
    }
    return reply.status(201).send({ call });
    },
  );

  // ─── Ответ на звонок: открыть дверь ──────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/intercom/:id/open',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Звонок не найден');

      const pointId = await pointOfCall(auth.userId, idParsed.data);
      if (!pointId) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Звонок уже завершён или не найден');
      }

      // Открываем через тот же провайдер, что и обычную кнопку доступа:
      // права и журнал остаются едиными
      const outcome = await openAccessPoint({
        userId: auth.userId,
        pointId,
        source: 'app',
      });

      if (!outcome.ok) {
        return fail(request, reply, outcome.status, outcome.code, outcome.message);
      }

      await finishCall(auth.userId, idParsed.data, 'opened');

      // Дверь открыта — просим панель положить трубку. Иначе вызов на табло
      // продолжается, хотя житель уже всё сделал (замечено на стенде).
      await hangupCall(idParsed.data).catch(() => false);

      return reply.send({ message: outcome.message, openedAt: outcome.openedAt });
    },
  );

  // ─── Ответ на звонок: отклонить ──────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/intercom/:id/decline',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Звонок не найден');

      const done = await finishCall(auth.userId, idParsed.data, 'declined');
      if (!done) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Звонок уже завершён или не найден');
      }

      // Отказ — тоже повод сбросить вызов на панели, иначе гость продолжает
      // слышать вызов и не понимает, что ему отказали.
      await hangupCall(idParsed.data).catch(() => false);

      return reply.status(204).send();
    },
  );
}
