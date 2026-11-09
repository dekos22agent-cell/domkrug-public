/**
 * Ответы об ошибках в едином формате.
 *
 * Один помощник на весь проект: иначе в каждом модуле появится свой
 * «почти такой же» формат, и клиент начнёт разбирать три разных.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown;
    requestId: string;
  };
}

export function fail(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): FastifyReply {
  const body: ApiErrorBody = {
    error: { code, message, details, requestId: request.id },
  };
  return reply.status(status).send(body);
}

/**
 * 404 вместо 403 для объектов чужой УК.
 *
 * 403 подтверждает существование объекта — это утечка. Для чужих данных
 * отвечаем так же, как на несуществующие.
 */
export function notFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return fail(request, reply, 404, 'NOT_FOUND', 'Объект не найден');
}
