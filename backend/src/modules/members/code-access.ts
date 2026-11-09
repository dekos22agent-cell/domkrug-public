/**
 * Доступ по коду.
 *
 * Собственник создаёт код в кабинете. Человек вводит его на экране входа и
 * получает урезанный интерфейс: адрес, кнопки открытия, срок действия.
 * Ни регистрации, ни телефона, ни согласия на обработку ПДн — их просто нет.
 *
 * Код — секрет. Храним bcrypt-хеш, показываем один раз, проверяем с задержкой
 * (bcrypt медленный специально) и ограничиваем число попыток на маршруте.
 *
 * Сессия гостя — отдельный JWT с типом `guest` и идентификатором членства.
 * Права берутся из записи членства, поэтому отзыв доступа действует сразу:
 * следующий запрос увидит `status = 'revoked'` и не пустит.
 */
import { createHmac, randomInt } from 'node:crypto';
import { pool } from '../../db/pool.js';
import { hashPasswordAsync, verifyPasswordAsync } from '../../lib/password.js';
import { sealSecret } from '../../lib/secrets.js';
import { config } from '../../config.js';

/** Алфавит без похожих символов: 0/O, 1/I/L путают при диктовке. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/**
 * HMAC-ключ для индекса: по дампу базы без серверного секрета код не
 * перебрать офлайн. Отдельный CODE_SECRET, если задан.
 */
export function codeLookup(code: string): string {
  return createHmac('sha256', config.codeSecret)
    .update(normalizeCode(code))
    .digest('hex');
}

export interface GuestContext {
  memberId: string;
  apartmentId: string;
  apartmentNumber: string;
  addressText: string;
  tenantId: string;
  tenantName: string;
  buildingId: string;
  scopes: string[];
  label: string | null;
  expiresAt: string | null;
  isActive: boolean;
}

function randomCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    // crypto.randomInt, а не Math.random: код — секрет, предсказуемый
    // генератор здесь недопустим.
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  // Группируем по 4: проще продиктовать и ввести
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Приводим ввод к виду AAAA-BBBB: человек может ввести без дефиса или строчными. */
export function normalizeCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== CODE_LENGTH) return input.toUpperCase().trim();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

interface MemberRow {
  id: string;
  apartment_id: string;
  apartment_number: string;
  address_text: string;
  building_id: string;
  tenant_id: string;
  tenant_name: string;
  scopes: string[];
  label: string | null;
  expires_at: string | null;
  status: string;
}

const MEMBER_SELECT = `
  SELECT m.id, m.apartment_id, a.number AS apartment_number, b.address_text,
         a.building_id, t.id AS tenant_id, t.name AS tenant_name,
         m.scopes, m.label, m.expires_at::text AS expires_at, m.status
    FROM apartment_members m
    JOIN apartments a ON a.id = m.apartment_id
    JOIN buildings b ON b.id = a.building_id
    JOIN tenants t ON t.id = m.tenant_id
`;

function toGuest(row: MemberRow): GuestContext {
  return {
    memberId: row.id,
    apartmentId: row.apartment_id,
    apartmentNumber: row.apartment_number,
    addressText: row.address_text,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    buildingId: row.building_id,
    scopes: row.scopes,
    label: row.label,
    expiresAt: row.expires_at,
    isActive:
      row.status === 'active' &&
      (row.expires_at === null || new Date(row.expires_at).getTime() > Date.now()),
  };
}

export interface IssuedCode {
  memberId: string;
  code: string;
  prefix: string;
}

/**
 * Создать доступ по коду.
 *
 * Код возвращается один раз: в базе только хеш. Если потеряли — владелец
 * выпускает новый, старый перестаёт работать.
 */
export async function createCodeAccess(input: {
  ownerUserId: string;
  apartmentId: string;
  preset: 'family' | 'child' | 'tenant' | 'worker' | 'guest';
  scopes: string[];
  label: string;
  expiresAt: string | null;
}): Promise<IssuedCode | null> {
  const apartment = await pool.query<{ tenant_id: string }>(
    'SELECT tenant_id FROM apartments WHERE id = $1',
    [input.apartmentId],
  );
  const tenantId = apartment.rows[0]?.tenant_id;
  if (!tenantId) return null;

  const code = randomCode();
  const hash = await hashPasswordAsync(code);

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO apartment_members
       (tenant_id, apartment_id, phone, preset, scopes, status, invited_by,
        expires_at, accepted_at, kind, access_code_hash, access_code_prefix, label,
        access_code_sealed, access_code_lookup)
     VALUES ($1, $2, NULL, $3, $4, 'active', $5, $6::timestamptz, now(),
             'code', $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      tenantId,
      input.apartmentId,
      input.preset,
      input.scopes,
      input.ownerUserId,
      input.expiresAt,
      hash,
      code.slice(0, 4),
      input.label,
      sealSecret(code),
      codeLookup(code),
    ],
  );

  const memberId = inserted.rows[0]?.id;
  if (!memberId) return null;
  return { memberId, code, prefix: code.slice(0, 4) };
}

/**
 * Войти по коду.
 *
 * Ищем одну строку по HMAC-ключу (индекс), затем проверяем bcrypt только
 * её. Раньше перебирали все активные коды и на каждом запускали scrypt —
 * одна попытка при сотнях кодов вешала Node.
 */
export async function authenticateByCode(rawCode: string): Promise<GuestContext | null> {
  const code = normalizeCode(rawCode);
  if (code.length < 4) return null;

  const candidates = await pool.query<MemberRow & { access_code_hash: string }>(
    `SELECT m.id, m.apartment_id, a.number AS apartment_number, b.address_text,
            a.building_id, t.id AS tenant_id, t.name AS tenant_name,
            m.scopes, m.label, m.expires_at::text AS expires_at, m.status,
            m.access_code_hash
       FROM apartment_members m
       JOIN apartments a ON a.id = m.apartment_id
       JOIN buildings b ON b.id = a.building_id
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.kind = 'code'
        AND m.status = 'active'
        AND (m.expires_at IS NULL OR m.expires_at > now())
        AND m.access_code_lookup = $1
      LIMIT 1`,
    [codeLookup(code)],
  );

  const row = candidates.rows[0];
  if (row && row.access_code_hash) {
    if (!(await verifyPasswordAsync(code, row.access_code_hash))) return null;
    return toGuest(row);
  }

  // Совместимость с кодами, созданными до миграции 023: у них lookup ещё
  // NULL (в том числе если старое sealed-значение не расшифровалось).
  // Перебираем только такие строки — их единицы; при успехе сохраняем
  // lookup, и следующий вход уже идёт по индексу.
  const legacy = await pool.query<MemberRow & { access_code_hash: string }>(
    `SELECT m.id, m.apartment_id, a.number AS apartment_number, b.address_text,
            a.building_id, t.id AS tenant_id, t.name AS tenant_name,
            m.scopes, m.label, m.expires_at::text AS expires_at, m.status,
            m.access_code_hash
       FROM apartment_members m
       JOIN apartments a ON a.id = m.apartment_id
       JOIN buildings b ON b.id = a.building_id
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.kind = 'code'
        AND m.status = 'active'
        AND (m.expires_at IS NULL OR m.expires_at > now())
        AND m.access_code_lookup IS NULL
      LIMIT 50`,
  );

  for (const candidate of legacy.rows) {
    if (!candidate.access_code_hash) continue;
    if (!(await verifyPasswordAsync(code, candidate.access_code_hash))) continue;
    await pool.query(
      'UPDATE apartment_members SET access_code_lookup = $2 WHERE id = $1',
      [candidate.id, codeLookup(code)],
    );
    return toGuest(candidate);
  }

  return null;
}

/** Данные гостя по его сессии: свежие права и статус, не из токена. */
export async function getGuestContext(memberId: string): Promise<GuestContext | null> {
  const res = await pool.query<MemberRow>(`${MEMBER_SELECT} WHERE m.id = $1`, [memberId]);
  const row = res.rows[0];
  if (!row) return null;
  return toGuest(row);
}
