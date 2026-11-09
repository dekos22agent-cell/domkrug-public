/**
 * Второй фактор (TOTP): состояние, настройка, резервные коды.
 *
 * Идея потока:
 *   setup   — выдаём секрет, но вход по нему ещё не требуется;
 *   enable  — пользователь присылает код, мы убеждаемся, что приложение
 *             настроено правильно, и только тогда включаем второй фактор;
 *   login   — если включён, без кода (или резервного кода) сессии нет;
 *   disable — пароль + действующий код, иначе «одна украденная сессия»
 *             сможет снять защиту.
 *
 * Принудительного включения по роли пока нет: список `required` — это
 * подсказка интерфейсу. Заблокировать вход всем диспетчерам сразу — значит
 * запереть пилот, если кто-то не успел настроить приложение. Жёсткое
 * требование добавим отдельным флагом, когда все учётки настроены.
 */
import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../../db/pool.js';
import { generateSecret, otpauthUri, verifyTotp } from '../../lib/totp.js';
import type { UserRow } from './service.js';

/** Роли с доступом к данным сотен квартир — им второй фактор нужен по-настоящему. */
export const TWO_FACTOR_REQUIRED_ROLES = ['uk_admin', 'dispatcher', 'platform_admin'] as const;

const BACKUP_CODE_COUNT = 10;
/** Без 0/O/1/I: коды диктуют и вводят руками, похожие символы — источник ошибок. */
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function isTwoFactorRequired(roles: readonly string[]): boolean {
  return roles.some((role) => (TWO_FACTOR_REQUIRED_ROLES as readonly string[]).includes(role));
}

export interface TwoFactorState {
  enabled: boolean;
  required: boolean;
  backupCodesLeft: number;
}

export async function getTwoFactorState(
  userId: string,
  roles: readonly string[],
): Promise<TwoFactorState> {
  const res = await pool.query<{ enabled: boolean; backup_codes_left: string }>(
    `SELECT u.totp_enabled AS enabled,
            (SELECT count(*) FROM totp_backup_codes c
              WHERE c.user_id = u.id AND c.used_at IS NULL)::text AS backup_codes_left
       FROM users u
      WHERE u.id = $1`,
    [userId],
  );
  const row = res.rows[0];

  return {
    enabled: row?.enabled ?? false,
    required: isTwoFactorRequired(roles),
    backupCodesLeft: Number(row?.backup_codes_left ?? 0),
  };
}

/** Новый секрет. Старый (если был) заменяется: начатая настройка сбрасывается. */
export async function startTotpSetup(
  userId: string,
  account: string,
): Promise<{ secret: string; otpauthUrl: string }> {
  const secret = generateSecret();
  await pool.query(
    `UPDATE users
        SET totp_secret = $2, totp_enabled = false, totp_enabled_at = NULL
      WHERE id = $1 AND deleted_at IS NULL`,
    [userId, secret],
  );
  return { secret, otpauthUrl: otpauthUri({ secret, account }) };
}

export type ConfirmTotpResult =
  | { ok: true; backupCodes: string[] }
  | { ok: false; reason: 'already_enabled' | 'not_started' | 'invalid_code' };

/**
 * Подтверждение настройки кодом. Резервные коды выдаются один раз —
 * в базе остаются только их хеши.
 */
export async function confirmTotpSetup(
  userId: string,
  code: string,
): Promise<ConfirmTotpResult> {
  const res = await pool.query<{ totp_secret: string | null; totp_enabled: boolean }>(
    'SELECT totp_secret, totp_enabled FROM users WHERE id = $1 AND deleted_at IS NULL',
    [userId],
  );
  const row = res.rows[0];
  if (!row) return { ok: false, reason: 'not_started' };
  if (row.totp_enabled) return { ok: false, reason: 'already_enabled' };
  if (!row.totp_secret) return { ok: false, reason: 'not_started' };
  if (!verifyTotp(row.totp_secret, code)) return { ok: false, reason: 'invalid_code' };

  const backupCodes = generateBackupCodes();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE users SET totp_enabled = true, totp_enabled_at = now() WHERE id = $1',
      [userId],
    );
    // Повторная настройка могла оставить старые коды — они больше не действуют
    await client.query('DELETE FROM totp_backup_codes WHERE user_id = $1', [userId]);
    for (const backupCode of backupCodes) {
      await client.query(
        'INSERT INTO totp_backup_codes (user_id, code_hash) VALUES ($1, $2)',
        [userId, hashBackupCode(backupCode)],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { ok: true, backupCodes };
}

export async function disableTotp(userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE users
          SET totp_secret = NULL, totp_enabled = false, totp_enabled_at = NULL
        WHERE id = $1`,
      [userId],
    );
    await client.query('DELETE FROM totp_backup_codes WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Проверка второго фактора при входе.
 *
 * Возвращает `required`, если код вообще не прислали: клиенту нужно показать
 * поле ввода, а не «неверный пароль».
 */
export type SecondFactorCheck =
  | { ok: true; method: 'totp' | 'backup' | null }
  | { ok: false; reason: 'required' | 'invalid' };

export async function checkSecondFactor(
  user: Pick<UserRow, 'id' | 'totp_enabled' | 'totp_secret'>,
  input: { totpCode?: string | undefined; backupCode?: string | undefined },
): Promise<SecondFactorCheck> {
  if (!user.totp_enabled) return { ok: true, method: null };

  if (input.totpCode) {
    if (user.totp_secret && verifyTotp(user.totp_secret, input.totpCode)) {
      return { ok: true, method: 'totp' };
    }
    return { ok: false, reason: 'invalid' };
  }

  if (input.backupCode) {
    const used = await consumeBackupCode(user.id, input.backupCode);
    return used ? { ok: true, method: 'backup' } : { ok: false, reason: 'invalid' };
  }

  return { ok: false, reason: 'required' };
}

export async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  // Атомарно: два одновременных входа одним кодом не должны оба пройти
  const res = await pool.query(
    `UPDATE totp_backup_codes
        SET used_at = now()
      WHERE id = (
              SELECT id FROM totp_backup_codes
               WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
               LIMIT 1
            )
        AND used_at IS NULL
      RETURNING id`,
    [userId, hashBackupCode(code)],
  );
  return (res.rowCount ?? 0) > 0;
}

export function hashBackupCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return createHash('sha256').update(normalized).digest('hex');
}

function generateBackupCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < BACKUP_CODE_COUNT) {
    const bytes = randomBytes(8);
    let raw = '';
    for (const byte of bytes) {
      // 32 символа в алфавите, 256 делится на 32 — смещения нет
      raw += BACKUP_ALPHABET[byte % BACKUP_ALPHABET.length];
    }
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return [...codes];
}
