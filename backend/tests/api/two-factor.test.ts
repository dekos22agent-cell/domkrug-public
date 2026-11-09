/**
 * Второй фактор (TOTP): настройка, вход по коду и резервному коду, отключение.
 *
 * Тест идёт на свежем жителе, а не на демо-диспетчере: если сценарий упадёт
 * посередине, включённый второй фактор не запрёт остальные тесты.
 * Механизм не привязан к роли — проверяем его, а обязательность для
 * диспетчеров проверяем отдельно по флагу `required`.
 */
import { describe, expect, it } from 'vitest';
import { stepAt, totpAt } from '../../src/lib/totp.js';
import { ApiClient, errorCode, login, uniquePhone } from './helpers.js';

interface SetupResponse {
  secret: string;
  otpauthUrl: string;
}

interface EnableResponse {
  enabled: boolean;
  backupCodes: string[];
}

interface MeBody {
  twoFactor?: { enabled: boolean; required: boolean; backupCodesLeft: number };
}

const PASSWORD = 'TestPass123';

describe('Второй фактор', () => {
  it('диспетчеру он показан как обязательный, пока не включён', async () => {
    const { client } = await login({ identifier: '+79000000002', audience: 'staff' });

    const state = await client.get<{ enabled: boolean; required: boolean }>('/auth/2fa');
    expect(state.status).toBe(200);
    expect(state.data?.enabled).toBe(false);
    expect(state.data?.required).toBe(true);

    const me = await client.get<MeBody>('/auth/me');
    expect(me.data?.twoFactor?.required).toBe(true);
  });

  it('полный цикл: включение, вход по коду и резервному коду, отключение', async () => {
    const phone = uniquePhone();
    const owner = new ApiClient();
    const registered = await owner.post<{ accessToken: string }>('/auth/register', {
      fullName: 'Тест Второго Фактора',
      phone,
      password: PASSWORD,
      consentAccepted: true,
    });
    expect(registered.status).toBe(201);
    owner.accessToken = registered.data?.accessToken ?? null;

    // ─── Настройка ─────────────────────────────────────────────────────
    const setup = await owner.post<SetupResponse>('/auth/2fa/setup');
    expect(setup.status).toBe(200);
    const secret = setup.data?.secret ?? '';
    expect(secret).toMatch(/^[A-Z2-7]{20,}$/);
    expect(setup.data?.otpauthUrl.startsWith('otpauth://totp/')).toBe(true);

    // Код из далёкого окна не должен приниматься
    const staleCode = totpAt(secret, stepAt() - 5);
    const stale = await owner.post('/auth/2fa/enable', { code: staleCode });
    expect(stale.status).toBe(400);
    expect(errorCode(stale.data)).toBe('INVALID_TOTP');

    // Действующий код подтверждает, что секрет попал в аутентификатор
    const goodCode = totpAt(secret, stepAt());
    const enabled = await owner.post<EnableResponse>('/auth/2fa/enable', { code: goodCode });
    expect(enabled.status).toBe(200);
    expect(enabled.data?.enabled).toBe(true);
    const backupCodes = enabled.data?.backupCodes ?? [];
    expect(backupCodes).toHaveLength(10);
    expect(new Set(backupCodes).size).toBe(10);

    const meAfterEnable = await owner.get<MeBody>('/auth/me');
    expect(meAfterEnable.data?.twoFactor?.enabled).toBe(true);
    expect(meAfterEnable.data?.twoFactor?.backupCodesLeft).toBe(10);

    // ─── Вход ──────────────────────────────────────────────────────────
    const noCode = await new ApiClient().post('/auth/login', {
      identifier: phone,
      password: PASSWORD,
      audience: 'resident',
    });
    expect(noCode.status).toBe(401);
    expect(errorCode(noCode.data)).toBe('TOTP_REQUIRED');

    const badCode = await new ApiClient().post('/auth/login', {
      identifier: phone,
      password: PASSWORD,
      audience: 'resident',
      totpCode: staleCode,
    });
    expect(badCode.status).toBe(401);
    expect(errorCode(badCode.data)).toBe('INVALID_TOTP');

    const byCode = await new ApiClient().post<{ accessToken: string }>('/auth/login', {
      identifier: phone,
      password: PASSWORD,
      audience: 'resident',
      totpCode: goodCode,
    });
    expect(byCode.status).toBe(200);
    expect(byCode.data?.accessToken).toBeTruthy();

    const byBackup = await new ApiClient().post<{ accessToken: string }>('/auth/login', {
      identifier: phone,
      password: PASSWORD,
      audience: 'resident',
      backupCode: backupCodes[0],
    });
    expect(byBackup.status).toBe(200);

    // Резервный код одноразовый
    const reusedBackup = await new ApiClient().post('/auth/login', {
      identifier: phone,
      password: PASSWORD,
      audience: 'resident',
      backupCode: backupCodes[0],
    });
    expect(reusedBackup.status).toBe(401);
    expect(errorCode(reusedBackup.data)).toBe('INVALID_TOTP');

    const meAfterBackup = await owner.get<MeBody>('/auth/me');
    expect(meAfterBackup.data?.twoFactor?.backupCodesLeft).toBe(9);

    // ─── Отключение ────────────────────────────────────────────────────
    const wrongPassword = await owner.post('/auth/2fa/disable', {
      password: 'WrongPassword1!',
      code: goodCode,
    });
    expect(wrongPassword.status).toBe(400);
    expect(errorCode(wrongPassword.data)).toBe('INVALID_PASSWORD');

    const disabled = await owner.post('/auth/2fa/disable', {
      password: PASSWORD,
      code: goodCode,
    });
    expect(disabled.status).toBe(204);

    const meAfterDisable = await owner.get<MeBody>('/auth/me');
    expect(meAfterDisable.data?.twoFactor?.enabled).toBe(false);

    // Без второго фактора вход снова по одному паролю
    const plainLogin = await new ApiClient().post('/auth/login', {
      identifier: phone,
      password: PASSWORD,
      audience: 'resident',
    });
    expect(plainLogin.status).toBe(200);
  });
});
