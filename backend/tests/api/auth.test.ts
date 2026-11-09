/**
 * Тесты авторизации и прав.
 *
 * Требуют запущенного API и загруженных демо-данных:
 *   docker compose up -d && cd backend && npm run migrate && npm run db:seed && npm run dev
 *   npm run test:api
 */
import { describe, expect, it } from 'vitest';
import { ApiClient, errorCode, login, uniquePhone } from './helpers.js';

interface MeResponse {
  user: { id: string; fullName: string; phone: string | null };
  roles: string[];
  permissions: string[];
  tenant: { id: string; name: string; position: string | null } | null;
  bindings: { id: string; status: string }[];
}

interface LoginResponse {
  accessToken: string;
  roles: string[];
  tenant: { id: string; name: string } | null;
}

describe('Авторизация', () => {
  it('вход администратора УК возвращает токен, роль и УК', async () => {
    const { response } = await login({ identifier: '+79000000001' });

    expect(response.status).toBe(200);
    const body = response.data as LoginResponse;
    expect(body.accessToken).toBeTruthy();
    expect(body.roles).toContain('uk_admin');
    expect(body.tenant?.name).toContain('Дом-Сервис');
  });

  it('/auth/me отдаёт права роли и не отдаёт лишнего', async () => {
    const { client } = await login({ identifier: '+79000000001' });
    const me = await client.get<MeResponse>('/auth/me');

    expect(me.status).toBe(200);
    const body = me.data as MeResponse;
    expect(body.permissions).toHaveLength(48);
    expect(body.permissions).toContain('ticket.view.all');
    expect(body.permissions).toContain('ticket.close');
    // platform_admin-права не должны доставаться администратору УК
    expect(body.permissions).not.toContain('platform.audit.view');
  });

  it('профиль сотрудника: /auth/me отдаёт организацию, должность и роли', async () => {
    const { client } = await login({ identifier: '+79000000002', audience: 'staff' });
    const me = await client.get<MeResponse>('/auth/me');

    expect(me.status).toBe(200);
    const body = me.data as MeResponse;
    expect(body.roles).toContain('dispatcher');
    expect(body.tenant?.name).toContain('Дом-Сервис');
    expect(body.tenant?.position).toBe('Диспетчер');
  });

  it('/auth/session узнаёт вошедшего по refresh-cookie и не требует токена', async () => {
    const { client } = await login({ identifier: '+79000000101' });
    const session = await client.get<{ user: { fullName: string }; roles: string[] }>(
      '/auth/session',
    );

    expect(session.status).toBe(200);
    expect(session.data?.roles).toContain('resident');
    expect((session.data?.user.fullName.length ?? 0)).toBeGreaterThan(0);

    // Без cookie — гость, даже если бы был access-токен
    const anonymous = new ApiClient();
    const none = await anonymous.get('/auth/session');
    expect(none.status).toBe(401);
  });

  it('без токена и с поддельным токеном — 401', async () => {
    const anonymous = new ApiClient();
    const noToken = await anonymous.get('/auth/me');
    expect(noToken.status).toBe(401);

    const fake = new ApiClient();
    fake.accessToken = 'not-a-real-token';
    const badToken = await fake.get('/auth/me');
    expect(badToken.status).toBe(401);
  });

  it('регистрация жителя выдаёт сессию и требует привязки', async () => {
    const client = new ApiClient();
    const phone = uniquePhone();
    const response = await client.post<{ requiresBinding: boolean; accessToken: string }>(
      '/auth/register',
      {
        fullName: 'Тестовый Житель Кириллица',
        phone,
        password: 'TestPass123',
        consentAccepted: true,
      },
    );

    expect(response.status).toBe(201);
    expect(response.data?.requiresBinding).toBe(true);
    expect(response.data?.accessToken).toBeTruthy();

    client.accessToken = response.data?.accessToken ?? null;
    const me = await client.get<MeResponse>('/auth/me');
    const body = me.data as MeResponse;

    expect(body.roles).toContain('resident');
    expect(body.permissions).toHaveLength(14);
    expect(body.permissions).toContain('ticket.create');
    expect(body.permissions).not.toContain('ticket.view.all');
    expect(body.permissions).not.toContain('ticket.assign');
    expect(body.bindings).toHaveLength(0);

    // Кириллица должна вернуться байт-в-байт: это и есть проверка кодировки
    expect(body.user.fullName).toBe('Тестовый Житель Кириллица');
  });

  it('без согласия на обработку ПДн регистрация отклоняется', async () => {
    const client = new ApiClient();
    const response = await client.post('/auth/register', {
      fullName: 'Без Согласия',
      phone: uniquePhone(),
      password: 'TestPass123',
      consentAccepted: false,
    });

    expect(response.status).toBe(400);
    expect(errorCode(response.data)).toBe('VALIDATION_ERROR');
  });

  it('неверный пароль и несуществующий пользователь дают одинаковый ответ', async () => {
    const badPassword = await new ApiClient().post('/auth/login', {
      identifier: '+79000000001',
      password: 'wrong-password',
    });
    expect(badPassword.status).toBe(401);
    expect(errorCode(badPassword.data)).toBe('INVALID_CREDENTIALS');

    const unknownUser = await new ApiClient().post('/auth/login', {
      identifier: '+79999999999',
      password: 'whatever',
    });
    expect(unknownUser.status).toBe(401);
    expect(errorCode(unknownUser.data)).toBe('INVALID_CREDENTIALS');
  });

  it('refresh ротирует токен и cookie', async () => {
    const { client, response } = await login({ identifier: '+79000000001' });
    const firstToken = (response.data as LoginResponse).accessToken;

    const oldRefresh = client.cookie('refresh_token');
    expect(oldRefresh).toBeTruthy();

    const refreshed = await client.post<{ accessToken: string }>('/auth/refresh');
    expect(refreshed.status).toBe(200);
    expect(refreshed.data?.accessToken).toBeTruthy();
    expect(refreshed.data?.accessToken).not.toBe(firstToken);
    expect(client.cookie('refresh_token')).not.toBe(oldRefresh);
  });

  it('два одновременных refresh не создают две живые сессии', async () => {
    const { client } = await login({ identifier: '+79000000001' });
    const refresh = client.cookie('refresh_token') as string;

    const first = new ApiClient();
    first.setCookie('refresh_token', refresh);
    const second = new ApiClient();
    second.setCookie('refresh_token', refresh);

    const [a, b] = await Promise.all([
      first.post<{ accessToken: string }>('/auth/refresh'),
      second.post<{ accessToken: string }>('/auth/refresh'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);

    // Победитель остаётся в системе: вторая вкладка не должна закрывать его
    const winner = a.status === 200 ? first : second;
    winner.accessToken = (a.status === 200 ? a.data : b.data)?.accessToken ?? null;
    const me = await winner.get('/auth/me');
    expect(me.status).toBe(200);
  });

  it('повторное использование старого refresh закрывает все сессии', async () => {
    const { client } = await login({ identifier: '+79000000001' });
    const oldRefresh = client.cookie('refresh_token') as string;

    // Легитимная ротация
    const rotated = await client.post('/auth/refresh');
    expect(rotated.status).toBe(200);

    // Старый токен переиспользован позже 5-секундного окна «вторая вкладка»
    await new Promise((resolve) => setTimeout(resolve, 6000));

    // «Злоумышленник» со старым токеном
    const thief = new ApiClient();
    thief.setCookie('refresh_token', oldRefresh);
    const reuse = await thief.post('/auth/refresh');
    expect(reuse.status).toBe(401);
    expect(errorCode(reuse.data)).toBe('SESSION_REVOKED');

    // После подозрения на кражу текущая сессия тоже закрыта
    const afterTheft = await client.post('/auth/refresh');
    expect(afterTheft.status).toBe(401);

    // И можно войти заново
    const relogin = await login({ identifier: '+79000000001' });
    expect(relogin.response.status).toBe(200);
  });

  it('выход отзывает сессию: refresh больше не работает', async () => {
    const { client } = await login({ identifier: '+79000000001' });

    const logout = await client.post('/auth/logout');
    expect(logout.status).toBe(204);

    const afterLogout = await client.post('/auth/refresh');
    expect(afterLogout.status).toBe(401);
  });
  it('профиль можно дозаполнить: почта и дата рождения', async () => {
    const { client } = await login({ identifier: '+79000000101' });

    const patched = await client.patch<{
      user: { email: string | null; birthDate: string | null };
    }>('/auth/me', { email: 'Ivan@Example.RU', birthDate: '1990-05-14' });
    expect(patched.status).toBe(200);
    // Почта приводится к нижнему регистру — иначе получатся две разные записи
    expect(patched.data?.user.email).toBe('ivan@example.ru');
    expect(patched.data?.user.birthDate).toBe('1990-05-14');

    // Значение реально сохранилось, а не только вернулось в ответе
    const me = await client.get<{ user: { email: string | null; birthDate: string | null } }>(
      '/auth/me',
    );
    expect(me.data?.user.email).toBe('ivan@example.ru');
    expect(me.data?.user.birthDate).toBe('1990-05-14');
  });

  it('дата рождения в будущем отклоняется', async () => {
    const { client } = await login({ identifier: '+79000000101' });

    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const response = await client.patch('/auth/me', { birthDate: future });
    expect(response.status).toBe(400);
    expect(errorCode(response.data)).toBe('VALIDATION_ERROR');
  });
  it('СНИЛС сохраняется и приводится к цифрам', async () => {
    const { client } = await login({ identifier: '+79000000101' });

    // Дефисы и пробелы — нормальный ввод, в базе должны остаться только цифры
    const patched = await client.patch<{ user: { snils: string | null } }>('/auth/me', {
      snils: '112-233-445 95',
    });
    expect(patched.status).toBe(200);
    expect(patched.data?.user.snils).toBe('11223344595');

    const me = await client.get<{ user: { snils: string | null } }>('/auth/me');
    expect(me.data?.user.snils).toBe('11223344595');
  });

  it('СНИЛС с неверной контрольной суммой отклоняется', async () => {
    const { client } = await login({ identifier: '+79000000101' });

    // Последняя цифра изменена — такого номера не существует
    const response = await client.patch('/auth/me', { snils: '11223344596' });
    expect(response.status).toBe(400);
    expect(errorCode(response.data)).toBe('VALIDATION_ERROR');
  });

  it('СНИЛС можно стереть пустой строкой', async () => {
    const { client } = await login({ identifier: '+79000000101' });

    const cleared = await client.patch<{ user: { snils: string | null } }>('/auth/me', {
      snils: '',
    });
    expect(cleared.status).toBe(200);
    expect(cleared.data?.user.snils).toBeNull();
  });

  it('учётка УК не входит в приложение жителя и ответ неотличим от неверного пароля', async () => {
    const wrongApp = await login({ identifier: '+79000000002', audience: 'resident' });
    expect(wrongApp.response.status).toBe(401);
    expect(wrongApp.response.text).toContain('INVALID_CREDENTIALS');

    const wrongPassword = await login({
      identifier: '+79000000002',
      password: 'NotThePassword1!',
      audience: 'resident',
    });
    expect(wrongPassword.response.status).toBe(401);
    // Ответы должны быть одинаковыми: иначе по форме входа можно узнать,
    // что учётка существует и работает в другой роли. Сравниваем код и
    // текст ошибки: requestId у каждого запроса свой.
    const body = (text: string) => {
      const parsed = JSON.parse(text) as { error: { code: string; message: string } };
      return { code: parsed.error.code, message: parsed.error.message };
    };
    expect(body(wrongPassword.response.text)).toEqual(body(wrongApp.response.text));

    const ownApp = await login({ identifier: '+79000000002', audience: 'staff' });
    expect(ownApp.response.status).toBe(200);
  });

  it('житель не входит в кабинет УК', async () => {
    const wrongApp = await login({ identifier: '+79000000101', audience: 'staff' });
    expect(wrongApp.response.status).toBe(401);
    expect(wrongApp.response.text).toContain('INVALID_CREDENTIALS');

    const ownApp = await login({ identifier: '+79000000101', audience: 'resident' });
    expect(ownApp.response.status).toBe(200);
  });
});
