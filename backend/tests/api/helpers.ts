/**
 * Клиент API для интеграционных тестов.
 *
 * ПОЧЕМУ NODE, А НЕ POWERSHELL.
 * Тесты на .ps1 проходят через границу «строка PowerShell → HTTP», а Windows
 * PowerShell 5.1 кодирует тело запроса в ANSI. Кириллица превращалась в «?»
 * ещё до отправки — и в базу попадали строки вида «????? ????».
 * Node работает с UTF-8 нативно: такой границы просто нет.
 *
 * Дополнительно: работать с cookie в Node приходится вручную (fetch не хранит
 * их сам), но это 20 строк — дешевле, чем один раз поймать испорченные данные.
 */

export const BASE_URL = process.env['API_URL'] ?? 'http://localhost:3000';

export interface ApiResponse<T> {
  status: number;
  data: T | null;
  /** Сырой текст ответа: нужен, когда тело не JSON (например, 204). */
  text: string;
}

interface LoginResponse {
  accessToken: string;
  roles?: string[];
  tenant?: { id: string; name: string } | null;
}

/**
 * Клиент с собственным набором cookie.
 *
 * Отдельный экземпляр на каждого пользователя — иначе cookie одного
 * «протекают» в запросы другого, и тесты перестают быть независимыми.
 */
export class ApiClient {
  private cookies = new Map<string, string>();
  accessToken: string | null = null;

  async request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (body !== undefined) {
      // charset=utf-8 явно: сервер должен знать, в какой кодировке байты
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    if (this.cookies.size > 0) {
      headers['Cookie'] = [...this.cookies.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }

    const response = await fetch(`${BASE_URL}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    this.storeCookies(response);

    const text = await response.text();
    let data: T | null = null;
    if (text.length > 0) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        // Не JSON — оставляем null, тест увидит текст в поле text
        data = null;
      }
    }

    return { status: response.status, data, text };
  }

  get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  /** Загрузка файла multipart-ом: как в браузере, но без UI. */
  async postForm<T>(path: string, form: FormData): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    if (this.cookies.size > 0) {
      headers['Cookie'] = [...this.cookies.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }

    const response = await fetch(`${BASE_URL}/api/v1${path}`, {
      method: 'POST',
      headers,
      body: form,
    });
    this.storeCookies(response);

    const raw = await response.text();
    let data: T | null = null;
    if (raw.length > 0) {
      try {
        data = JSON.parse(raw) as T;
      } catch {
        data = null;
      }
    }
    return { status: response.status, data, text: raw };
  }

  patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, body);
  }

  put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body);
  }

  delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path);
  }

  /** Значение cookie по имени (нужно для сценария кражи refresh-токена). */
  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  private storeCookies(response: Response): void {
    // getSetCookie() есть в Node 20+; повторные Set-Cookie приходят массивом
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const pair = line.split(';')[0];
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      // Пустое значение = cookie удалена (logout)
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

export interface LoginOptions {
  /** resident или staff: сервер не пустит чужую учётку */
  audience?: 'resident' | 'staff';
  identifier: string;
  password?: string;
  /** Готовый клиент, если нужен именно он. По умолчанию создаётся новый. */
  client?: ApiClient;
}

/** Вход под демо-пользователем. Пароль по умолчанию — из README. */
export async function login({
  identifier,
  password = 'Demo1234!',
  audience,
  client = new ApiClient(),
}: LoginOptions): Promise<{ client: ApiClient; response: ApiResponse<LoginResponse> }> {
  const response = await client.post<LoginResponse>('/auth/login', { identifier, password, audience });
  if (response.status === 200 && response.data?.accessToken) {
    client.accessToken = response.data.accessToken;
  }
  return { client, response };
}

/**
 * Уникальный телефон для регистрации в тесте.
 *
 * Формат сервера: ^\+7\d{10}$ — после «+7» ровно десять цифр.
 * Итого «+7900» + 7 цифр = 10, иначе валидация вернёт 400.
 */
export function uniquePhone(): string {
  const suffix = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  return `+7900${suffix}`;
}

/**
 * Тело ошибки в едином формате.
 * Возвращает код ошибки, чтобы можно было проверить причину, а не только статус.
 */
export function errorCode(data: unknown): string | undefined {
  const maybe = data as { error?: { code?: string } } | null;
  return maybe?.error?.code;
}
