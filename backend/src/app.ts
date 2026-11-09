/**
 * Сборка Fastify-приложения.
 *
 * Вынесено из index.ts, чтобы тесты могли поднимать приложение
 * без реального прослушивания порта: `const app = await buildApp()`.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { config } from './config.js';
import { scaledLimit } from './lib/limits.js';
import { healthRoutes } from './modules/health/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { twoFactorRoutes } from './modules/auth/two-factor-routes.js';
import { internalRoutes } from './modules/internal/routes.js';
import { publicRoutes } from './modules/public/routes.js';
import { propertiesRoutes } from './modules/properties/routes.js';
import { residentBindingRoutes, staffBindingRoutes } from './modules/bindings/routes.js';
import { residentAccessRoutes } from './modules/access/routes.js';
import { residentContactRoutes } from './modules/contacts/routes.js';
import { residentEmergencyRoutes } from './modules/emergency/routes.js';
import { residentLiftRoutes } from './modules/lifts/routes.js';
import { guestRoutes } from './modules/members/guest-routes.js';
import { residentMemberRoutes } from './modules/members/routes.js';
import { residentMeterRoutes } from './modules/meters/routes.js';
import { residentVideoRoutes } from './modules/video/routes.js';
import { residentTicketRoutes, staffTicketRoutes } from './modules/tickets/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { residentNewsRoutes, staffNewsRoutes } from './modules/news/routes.js';
import { residentDocumentRoutes, staffDocumentRoutes } from './modules/documents/routes.js';
import { staffContactRoutes } from './modules/contacts/staff-routes.js';
import { staffAuditRoutes } from './modules/audit/routes.js';
import { staffReportRoutes } from './modules/reports/routes.js';
import { updatesRoutes } from './modules/updates/routes.js';
import { AmiClient } from './modules/intercom/ami-client.js';
import {
  closeAllActiveCalls,
  handleAmiEvent,
  setAmiSender,
  sweepStaleCalls,
} from './modules/intercom/service.js';
import { staffRoutes } from './modules/staff/routes.js';
import { registerAuthGuards } from './plugins/auth.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // requestId — чтобы по жалобе «не работает» найти конкретный запрос
      serializers: {
        req(request) {
          return { method: request.method, url: request.url, id: request.id };
        },
      },
    },
    genReqId: () => randomUUID(),
    // Доверяем forwarded-заголовкам только локальному Caddy. `true` доверял
    // бы любому источнику: при случайном APP_HOST=0.0.0.0 X-Forwarded-For
    // можно подделать и обойти IP-лимиты.
    trustProxy: ['127.0.0.1', '::1'],
    bodyLimit: 1024 * 1024, // 1 МБ JSON; файлы идут отдельным путём
  });

  // ─── Безопасность ────────────────────────────────────────────────────────
  await app.register(helmet, {
    // PWA и загрузка картинок с того же origin — стандартные политики подходят
    contentSecurityPolicy: config.isProduction ? undefined : false,
  });

  await app.register(cors, {
    // В development — только локальный dev-сервер Vite, не «любой origin».
    // Открытый CORS с credentials в dev опаснее, чем кажется: если такой
    // сервер случайно окажется доступен по сети, любой сайт сможет слать
    // запросы с cookie пользователя.
    // В production обычно все три фронта ходят на свой же origin через
    // относительный /api, поэтому CORS не участвует; CORS_ORIGINS нужен,
    // если появится отдельный api-поддомен.
    origin:
      config.corsOrigins ??
      (config.isProduction
        ? [config.appUrl]
        : ['http://localhost:5173', 'http://127.0.0.1:5173', config.appUrl]),
    credentials: true, // refresh-токен в cookie
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    // В development лимит увеличен, а не отключён: механизм должен
    // выполняться и в разработке, иначе его ошибки всплывут только в проде.
    max: scaledLimit(100),
    timeWindow: '1 minute',
    // Ошибку лимита отдаём в нашем формате, а не в дефолтном
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      code: 'RATE_LIMITED',
      message: `Слишком много запросов. Повторите через ${Math.ceil(context.ttl / 1000)} с.`,
      details: null,
      requestId: null,
    }),
  });

  // ─── Единый формат ошибок ────────────────────────────────────────────────
  app.setErrorHandler((error: FastifyError | ZodError, request, reply) => {
    const requestId = request.id;

    // Ошибки валидации zod → 400 с перечнем полей
    if (error instanceof ZodError) {
      request.log.info({ err: error }, 'Ошибка валидации');
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Проверьте заполнение полей',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
          requestId,
        },
      });
    }

    // Ошибки Fastify с явным статусом (например, 429 от rate-limit)
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;

    // @fastify/rate-limit с кастомным телом бросает объект без statusCode,
    // но с нашим кодом RATE_LIMITED внутри. Без этой ветки лимит
    // превращался бы в 500 «внутренняя ошибка», что путает и клиент, и логи.
    const maybeRateLimited = error as unknown as {
      error?: { code?: string; message?: string };
    };
    if (maybeRateLimited.error?.code === 'RATE_LIMITED' || error.code === 'FST_ERR_RATE_LIMIT') {
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message:
            maybeRateLimited.error?.message ?? 'Слишком много запросов, попробуйте позже',
          details: null,
          requestId,
        },
      });
    }

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Внутренняя ошибка');
      // Наружу — без деталей: стек и SQL не должны утекать клиенту
      return reply.status(500).send({
        error: {
          code: 'INTERNAL',
          message: 'Внутренняя ошибка сервера',
          details: null,
          requestId,
        },
      });
    }

    return reply.status(statusCode).send({
      error: {
        code: error.code ?? 'BAD_REQUEST',
        message: error.message,
        details: null,
        requestId,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Запрос не найден',
        details: null,
        requestId: request.id,
      },
    });
  });

  // ─── Маршруты ────────────────────────────────────────────────────────────
  // Служебные — без префикса: их опрашивает инфраструктура (Docker, мониторинг)
  await app.register(healthRoutes);

  // JWT и проверки доступа
  await app.register(jwt, { secret: config.jwt.secret });

  // Фото заявок приходят multipart-ом. Лимит тот же, что в конфиге
  // хранилища: больше 10 МБ с телефона всё равно никто не ждёт.
  await app.register(multipart, {
    limits: { fileSize: config.storage.maxFileBytes, files: 1 },
  });

  registerAuthGuards(app);

  // Версионированное API — сюда будут добавляться модули
  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(twoFactorRoutes, { prefix: '/auth' });
      // Для Caddy on_demand_tls и публичного имени УК на поддомене
      await api.register(internalRoutes, { prefix: '/internal' });
      await api.register(publicRoutes, { prefix: '/public' });

      // Структура домов — сотрудники УК
      await api.register(propertiesRoutes);

      // Привязки: свои у жителя, обработка у УК
      await api.register(residentBindingRoutes, { prefix: '/resident' });
      await api.register(staffBindingRoutes, { prefix: '/resident-bindings' });

      // Заявки: свои у жителя, инбокс у УК
      await api.register(residentTicketRoutes, { prefix: '/resident' });
      await api.register(staffTicketRoutes, { prefix: '/tickets' });
      await api.register(staffRoutes, { prefix: '/staff' });
  await api.register(residentAccessRoutes, { prefix: '/resident/access' });
  await api.register(residentVideoRoutes, { prefix: '/resident/video' });
  await api.register(residentMeterRoutes, { prefix: '/resident/meters' });
  await api.register(residentMemberRoutes, { prefix: '/resident/members' });
  await api.register(guestRoutes, { prefix: '/guest' });
  await api.register(residentLiftRoutes, { prefix: '/resident/lifts' });
  await api.register(residentEmergencyRoutes, { prefix: '/resident/emergency' });
      await api.register(residentContactRoutes, { prefix: '/resident/contacts' });

      // Уведомления и сигнал обновлений — общие для всех ролей.
      // Живут вне /resident: колокольчик нужен и сотрудникам УК.
      await api.register(notificationRoutes, { prefix: '/notifications' });
  await api.register(residentNewsRoutes, { prefix: '/resident/news' });
  await api.register(staffNewsRoutes, { prefix: '/news' });
  await api.register(residentDocumentRoutes, { prefix: '/resident/documents' });
  await api.register(staffDocumentRoutes, { prefix: '/documents' });
  await api.register(staffContactRoutes, { prefix: '/contacts' });
  await api.register(staffAuditRoutes, { prefix: '/audit' });
  await api.register(staffReportRoutes, { prefix: '/reports' });
      await api.register(updatesRoutes, { prefix: '/updates' });
    },
    { prefix: '/api/v1' },
  );

  // ─── Звонки с вызывной панели (Asterisk AMI) ─────────────────────────────
  // Подключаемся только если AMI включён и учётка задана: иначе нечего делать
  // в закрытом порту. Соединение живёт вместе с процессом и закрывается на
  // остановке, а незавершённые звонки помечаются пропущенными — иначе в
  // журнале останутся «вечно звенящие» записи после каждого перезапуска.
  const intercomLog = {
    info: (message: string) => app.log.info(message),
    warn: (message: string) => app.log.warn(message),
  };

  if (config.ami.enabled) {
    const ami = new AmiClient(
      {
        host: config.ami.host,
        port: config.ami.port,
        user: config.ami.user,
        password: config.ami.password,
      },
      intercomLog,
      (event) => {
        void handleAmiEvent(event, intercomLog).catch((error: unknown) => {
          app.log.warn(`[ami] не удалось обработать событие: ${String(error)}`);
        });
      },
    );

    ami.start();

    // Даём сервису звонков возможность положить трубку на панели, когда
    // житель открыл дверь или отклонил вызов.
    setAmiSender((command) => {
      ami.send(command);
    });

    /*
     * Сторож звонков: раз в 30 секунд закрывает вызовы, которые «звенят»
     * дольше минуты. Событие Hangup приходит не всегда — без сторожа звонок
     * навсегда остаётся в статусе ringing, житель не получает уведомление о
     * пропущенном, а запись блокирует следующие вызовы (проверено 06.11).
     */
    const sweeper = setInterval(() => {
      void sweepStaleCalls(60)
        .then((closed) => {
          if (closed > 0) app.log.info(`[ami] закрыто зависших звонков: ${closed}`);
        })
        .catch((error: unknown) => {
          app.log.warn(`[ami] сторож звонков: ${String(error)}`);
        });
    }, 30_000);
    sweeper.unref?.();

    app.addHook('onClose', async () => {
      clearInterval(sweeper);
      setAmiSender(null);
      ami.stop();
      await closeAllActiveCalls().catch(() => undefined);
    });
  } else {
    app.log.info('[ami] выключен (AMI_ENABLED), звонки с панели не принимаются');
  }

  return app;
}
