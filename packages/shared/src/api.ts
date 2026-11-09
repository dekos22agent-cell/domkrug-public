/**
 * Клиент API «ДомКруг».
 *
 * Одна нетривиальная часть: access-токен живёт 15 минут, refresh — в httpOnly
 * cookie. Клиент обновляет токен незаметно и повторяет исходный запрос.
 *
 * Правила (docs/FRONTEND-PLAN.md п. 3):
 *  1. access-токен храним В ПАМЯТИ — не в localStorage (XSS его не достанет);
 *  2. при 401 один раз пробуем POST /auth/refresh (credentials: 'include');
 *  3. если refresh успешен — повторяем исходный запрос;
 *  4. если нет — разлогиниваем.
 *
 * Пути относительные ('/api/v1/...'): в dev их проксирует Vite на :3000,
 * поэтому cookie отправляется как same-origin (docs/DECISIONS.md).
 */

const API_BASE = '/api/v1';

/** Токен в памяти процесса. Перезагрузка страницы его теряет — это нормально:
 *  сессия восстанавливается через refresh-cookie при старте приложения. */
let accessToken: string | null = null;

/** Подписчики на «сессию кончилась». AuthProvider вешает сюда выход. */
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/** Ошибка API в человеческом виде. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown = null,
    requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    requestId?: string | null;
  };
}

/**
 * Разбор ответа с ошибкой.
 *
 * Сервер всегда отдаёт {error:{code,message,details,requestId}} — см.
 * docs/API-CONTRACT.md п. 2.3. Но если ответ пришёл не от приложения
 * (прокси, балансировщик), тело может быть любым — подстраховываемся.
 */
async function toApiError(response: Response): Promise<ApiError> {
  let code = 'UNKNOWN';
  let message = `Ошибка запроса (${response.status})`;
  let details: unknown = null;
  let requestId: string | null = null;
  /** Сервер объяснил причину сам — его текст важнее любого нашего. */
  let hasServerMessage = false;

  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error?.message) {
      code = body.error.code ?? code;
      message = body.error.message;
      details = body.error.details ?? null;
      requestId = body.error.requestId ?? null;
      hasServerMessage = true;
    }
  } catch {
    // Тело не JSON — остаются значения по умолчанию.
  }

  // Общие подстановки — ТОЛЬКО когда сервер ничего не сказал.
  // Иначе теряется смысл: 429 бывает и «слишком часто», и «повторное
  // обращение уже создано» — это разные ситуации с разными действиями.
  if (!hasServerMessage) {
    if (response.status === 429) {
      message = 'Слишком много запросов. Попробуйте через минуту.';
    } else if (response.status >= 500) {
      message = 'Внутренняя ошибка сервера. Мы уже знаем о ней.';
    }
  }

  // requestId нужен для разбора, но пользователю его не показываем —
  // поэтому только в консоль (docs/FRONTEND-PLAN.md п. 6).
  if (requestId) {
    console.error(`[api] requestId=${requestId} status=${response.status} code=${code}`);
  }

  return new ApiError(response.status, code, message, details, requestId);
}

/**
 * Общий промис refresh.
 *
 * Зачем: если пять запросов одновременно получили 401, без этого они вызовут
 * пять refresh-ей. Сервер ротирует refresh при каждом использовании и считает
 * повторное использование старого токена кражей → закрыл бы ВСЕ сессии.
 * Поэтому refresh ровно один, остальные ждут его результат.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        // Без этого cookie не отправится и не сохранится
        credentials: 'include',
      });

      if (!response.ok) {
        accessToken = null;
        return false;
      }

      const data = (await response.json()) as { accessToken?: string };
      if (!data.accessToken) {
        accessToken = null;
        return false;
      }

      accessToken = data.accessToken;
      return true;
    } catch {
      accessToken = null;
      return false;
    } finally {
      // Сбрасываем в конце, а не в начале: ожидающие промиса получат результат
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Тело запроса. Объект сериализуется в JSON, undefined — без тела. */
  body?: unknown;
  /** Не пытаться обновлять токен (нужно для самого refresh и для логина). */
  skipRefresh?: boolean;
}

/**
 * Запрос к API.
 *
 * Возвращает разобранный JSON или null для 204. Бросает ApiError.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, skipRefresh = false } = options;

  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      // Обязательно: без этого refresh-cookie не уйдёт и не сохранится
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let response = await doFetch();

  // 401 — токен истёк или подделан. Одна попытка refresh, потом повтор.
  if (response.status === 401 && !skipRefresh) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      onSessionExpired?.();
      throw await toApiError(response);
    }
    response = await doFetch();
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return null as T;
  }

  const text = await response.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

/**
 * Загрузка файла и получение файла потоком.
 *
 * Отдельные функции, потому что FormData нельзя отправлять с
 * `Content-Type: application/json`, а картинку нужно получить как blob:
 * `<img>` не умеет передавать заголовок Authorization.
 */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: form,
    });
  };

  let response = await doFetch();
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      onSessionExpired?.();
      throw await toApiError(response);
    }
    response = await doFetch();
  }

  if (!response.ok) throw await toApiError(response);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function apiBlob(path: string): Promise<Blob> {
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${API_BASE}${path}`, { method: 'GET', headers, credentials: 'include' });
  };

  let response = await doFetch();
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      onSessionExpired?.();
      throw await toApiError(response);
    }
    response = await doFetch();
  }

  if (!response.ok) throw await toApiError(response);
  return response.blob();
}

export const api = {
  /** Загрузка файла multipart-ом (фото заявки). */
  postForm: <T>(path: string, form: FormData): Promise<T> => apiUpload<T>(path, form),

  /** Файл как blob: нужен для показа картинок с авторизацией. */
  getBlob: (path: string): Promise<Blob> => apiBlob(path),

  get: <T>(path: string): Promise<T> => apiRequest<T>(path, { method: 'GET' }),

  post: <T>(path: string, body?: unknown, skipRefresh = false): Promise<T> =>
    apiRequest<T>(path, { method: 'POST', body, skipRefresh }),

  patch: <T>(path: string, body?: unknown): Promise<T> =>
    apiRequest<T>(path, { method: 'PATCH', body }),

  put: <T>(path: string, body?: unknown): Promise<T> =>
    apiRequest<T>(path, { method: 'PUT', body }),

  delete: <T>(path: string): Promise<T> => apiRequest<T>(path, { method: 'DELETE' }),

  /** Восстановление сессии после перезагрузки страницы. */
  refresh: refreshAccessToken,
};
