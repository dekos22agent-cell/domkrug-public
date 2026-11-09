/**
 * Сервисный слой авторизации: работа с пользователями, сессиями и аудитом.
 *
 * Никакой работы с HTTP здесь нет — только данные. Это позволяет
 * переиспользовать логику и тестировать её без поднятия сервера.
 */
import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../../db/pool.js';

export interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  full_name: string;
  birth_date: string | null;
  snils: string | null;
  status: 'active' | 'blocked' | 'deleted';
  /** Base32-секрет TOTP; null — второй фактор не настраивался. */
  totp_secret: string | null;
  /** true — при входе требуется код из приложения-аутентификатора. */
  totp_enabled: boolean;
}

export interface StaffTenant {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  position: string | null;
}

/** Нормализация идентификатора: телефон оставляем, e-mail приводим к нижнему регистру. */
export function normalizeIdentifier(raw: string): { phone: string | null; email: string | null } {
  const value = raw.trim();
  // Телефон: допускаем 8XXXXXXXXXX и +7XXXXXXXXXX, приводим к +7
  const digits = value.replace(/[^\d+]/g, '');
  if (/^(\+7|8)\d{10}$/.test(digits)) {
    const normalized = '+7' + digits.slice(-10);
    return { phone: normalized, email: null };
  }
  if (value.includes('@')) {
    return { phone: null, email: value.toLowerCase() };
  }
  return { phone: null, email: null };
}

export async function findUserByIdentifier(identifier: string): Promise<UserRow | null> {
  const { phone, email } = normalizeIdentifier(identifier);
  if (!phone && !email) return null;

  const res = await pool.query<UserRow>(
    `SELECT id, email::text AS email, phone, password_hash, full_name,
            birth_date::text AS birth_date, snils, status, totp_secret, totp_enabled
       FROM users
      WHERE deleted_at IS NULL
        AND ($1::text IS NOT NULL AND phone = $1 OR $2::text IS NOT NULL AND email = $2)
      LIMIT 1`,
    [phone, email],
  );
  return res.rows[0] ?? null;
}

export async function findUserById(userId: string): Promise<UserRow | null> {
  const res = await pool.query<UserRow>(
    `SELECT id, email::text AS email, phone, password_hash, full_name,
            birth_date::text AS birth_date, snils, status, totp_secret, totp_enabled
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  return res.rows[0] ?? null;
}

/**
 * Обновление профиля жителя.
 *
 * Меняются только переданные поля (undefined = «не трогать»).
 * Телефон не меняется здесь: он идентификатор входа, смена требует
 * подтверждения кодом — это отдельный сценарий, не «дозаполнение профиля».
 */
export async function updateUserProfile(
  userId: string,
  patch: { fullName?: string; email?: string | null; birthDate?: string | null; snils?: string | null },
): Promise<UserRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [userId];

  if (patch.fullName !== undefined) {
    params.push(patch.fullName);
    sets.push(`full_name = $${params.length}`);
  }
  if (patch.email !== undefined) {
    params.push(patch.email);
    sets.push(`email = $${params.length}`);
  }
  if (patch.birthDate !== undefined) {
    params.push(patch.birthDate);
    sets.push(`birth_date = $${params.length}`);
  }
  if (patch.snils !== undefined) {
    params.push(patch.snils);
    sets.push(`snils = $${params.length}`);
  }

  if (sets.length > 0) {
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params);
  }
  return findUserById(userId);
}

export interface CreateUserInput {
  fullName: string;
  email?: string | undefined;
  phone?: string | undefined;
  passwordHash: string;
}

/** Создаёт пользователя и выдаёт ему глобальную роль resident. */
export async function createResident(input: CreateUserInput): Promise<{ id: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query<{ id: string }>(
      `INSERT INTO users (email, phone, password_hash, full_name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.email ?? null, input.phone ?? null, input.passwordHash, input.fullName],
    );
    const userId = res.rows[0]?.id;
    if (!userId) throw new Error('Не удалось создать пользователя');

    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE code = 'resident'`,
      [userId],
    );

    await client.query('COMMIT');
    return { id: userId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Роли пользователя и УК, к которой он привязан как сотрудник. */
export async function getAccessContext(
  userId: string,
): Promise<{ roles: string[]; staffTenant: StaffTenant | null }> {
  const rolesRes = await pool.query<{ code: string }>(
    `SELECT DISTINCT r.code
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1`,
    [userId],
  );

  const staffRes = await pool.query<{
    tenant_id: string;
    name: string;
    slug: string;
    position: string | null;
  }>(
    `SELECT s.tenant_id, t.name, t.slug, s.position
       FROM staff s
       JOIN tenants t ON t.id = s.tenant_id
      WHERE s.user_id = $1 AND s.is_active = true
      ORDER BY s.created_at
      LIMIT 1`,
    [userId],
  );

  const staffRow = staffRes.rows[0];
  return {
    roles: rolesRes.rows.map((r) => r.code),
    staffTenant: staffRow
      ? {
          tenantId: staffRow.tenant_id,
          tenantName: staffRow.name,
          tenantSlug: staffRow.slug,
          position: staffRow.position,
        }
      : null,
  };
}

/**
 * Права пользователя = сумма прав его ролей в рамках его УК.
 *
 * Запрос выполняется на каждый запрос, без кеша. Причина: отзыв прав
 * (увольнение, блокировка) должен действовать немедленно, а не через
 * минуту после истечения кеша. На масштабе пилота это один лёгкий
 * запрос по индексам; кеш добавим, когда появится реальная нагрузка.
 */
export async function getPermissions(userId: string, tenantId: string | null): Promise<string[]> {
  const res = await pool.query<{ code: string }>(
    `SELECT DISTINCT p.code
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = $1
        AND (
          ur.tenant_id IS NULL
          OR ($2::uuid IS NOT NULL AND ur.tenant_id = $2::uuid)
        )`,
    [userId, tenantId],
  );
  return res.rows.map((r) => r.code);
}

/** Проверка, что пользователь — активный сотрудник указанной УК. */
export async function isStaffOf(userId: string, tenantId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM staff WHERE user_id = $1 AND tenant_id = $2 AND is_active = true LIMIT 1`,
    [userId, tenantId],
  );
  return (res.rowCount ?? 0) > 0;
}

// ─── Сессии ─────────────────────────────────────────────────────────────────

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRefreshTokenValue(): string {
  // Случайная часть, чтобы токены не совпадали даже при одинаковом payload
  return randomBytes(32).toString('base64url');
}

export async function createSession(input: {
  userId: string;
  token: string;
  expiresAt: Date;
  userAgent?: string | undefined;
  ip?: string | undefined;
}): Promise<{ id: string }> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      input.userId,
      hashToken(input.token),
      input.expiresAt,
      input.userAgent ?? null,
      input.ip ?? null,
    ],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error('Не удалось создать сессию');
  return { id };
}

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export async function findSessionByToken(token: string): Promise<SessionRow | null> {
  const res = await pool.query<SessionRow>(
    `SELECT id, user_id, expires_at, revoked_at
       FROM sessions WHERE token_hash = $1 LIMIT 1`,
    [hashToken(token)],
  );
  return res.rows[0] ?? null;
}

export async function findSessionById(sessionId: string): Promise<SessionRow | null> {
  const res = await pool.query<SessionRow>(
    `SELECT id, user_id, expires_at, revoked_at
       FROM sessions WHERE id = $1 LIMIT 1`,
    [sessionId],
  );
  return res.rows[0] ?? null;
}

/**
 * Атомарно забрать сессию на ротацию.
 *
 * Два одновременных /refresh (две вкладки, PWA) не должны оба создать новую
 * сессию. UPDATE ... WHERE revoked_at IS NULL возвращает строку только
 * одному запросу; второй увидит, что сессия уже отозвана.
 */
export async function claimSessionForRefresh(sessionId: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [sessionId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [
    sessionId,
  ]);
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const res = await pool.query(
    'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return res.rowCount ?? 0;
}

export async function touchSession(sessionId: string): Promise<void> {
  await pool.query('UPDATE sessions SET last_used_at = now() WHERE id = $1', [sessionId]);
}

// ─── Аудит ──────────────────────────────────────────────────────────────────

export async function writeAudit(input: {
  tenantId?: string | null;
  actorUserId?: string | null;
  actorIp?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (tenant_id, actor_user_id, actor_ip, action, entity_type, entity_id, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.tenantId ?? null,
      input.actorUserId ?? null,
      input.actorIp ?? null,
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
    ],
  );
}

/** Привязки жителя для ответа /auth/me. */
export interface BindingView {
  id: string;
  status: string;
  roleInApartment: string;
  apartmentId: string;
  apartmentNumber: string;
  buildingId: string;
  addressText: string;
  tenantId: string;
  tenantName: string;
  /** Причина отклонения — житель должен знать, почему ему отказали. */
  rejectReason: string | null;
  /** Площадь, м²; numeric приходит строкой, чтобы не терять точность. */
  areaTotal: string | null;
  rooms: number | null;
  kind: 'apartment' | 'nonresidential';
  entranceNumber: number | null;
  floorNumber: number | null;
  /** Данные дома — для карточки квартиры. */
  city: string;
  street: string;
  houseNumber: string;
  buildingFloors: number | null;
  buildingEntrances: number | null;
  buildingYear: number | null;
}

export async function getBindings(userId: string): Promise<BindingView[]> {
  const res = await pool.query<{
    id: string;
    status: string;
    role_in_apartment: string;
    apartment_id: string;
    number: string;
    building_id: string;
    address_text: string;
    tenant_id: string;
    tenant_name: string;
    reject_reason: string | null;
    area_total: string | null;
    rooms: number | null;
    kind: 'apartment' | 'nonresidential';
    entrance_number: number | null;
    floor_number: number | null;
    city: string;
    street: string;
    house_number: string;
    total_floors: number | null;
    total_entrances: number | null;
    year_built: number | null;
  }>(
    `SELECT rb.id, rb.status, rb.role_in_apartment,
            a.id AS apartment_id, a.number,
            b.id AS building_id, b.address_text,
            t.id AS tenant_id, t.name AS tenant_name,
            rb.reject_reason,
            a.area_total::text AS area_total,
            a.rooms,
            a.kind,
            e.number AS entrance_number,
            f.number AS floor_number,
            b.city, b.street, b.house_number,
            b.total_floors, b.total_entrances, b.year_built
       FROM resident_bindings rb
       JOIN apartments a ON a.id = rb.apartment_id
       JOIN buildings b ON b.id = a.building_id
       JOIN tenants t ON t.id = rb.tenant_id
       LEFT JOIN entrances e ON e.id = a.entrance_id
       LEFT JOIN floors f ON f.id = a.floor_id
      WHERE rb.user_id = $1
      ORDER BY rb.created_at`,
    [userId],
  );

  return res.rows.map((r) => ({
    id: r.id,
    status: r.status,
    roleInApartment: r.role_in_apartment,
    apartmentId: r.apartment_id,
    apartmentNumber: r.number,
    buildingId: r.building_id,
    addressText: r.address_text,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    rejectReason: r.reject_reason,
    areaTotal: r.area_total,
    rooms: r.rooms,
    kind: r.kind,
    entranceNumber: r.entrance_number,
    floorNumber: r.floor_number,
    city: r.city,
    street: r.street,
    houseNumber: r.house_number,
    buildingFloors: r.total_floors,
    buildingEntrances: r.total_entrances,
    buildingYear: r.year_built,
  }));
}
