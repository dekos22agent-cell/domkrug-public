/**
 * Привязка жителя к квартире.
 *
 * Флоу (решено 02.11.2026):
 *   1. Житель находит свой дом и квартиру.
 *   2. Отправляет заявку на привязку — статус pending.
 *   3. Сотрудник УК подтверждает или отклоняет с причиной.
 *   4. Только после confirmed житель может создавать заявки.
 *
 * Зачем подтверждение: без него любой мог бы заявить «я из кв. 42»
 * и видеть историю обращений этой квартиры.
 */
import { pool } from '../../db/pool.js';
import { decodeCursor, encodeCursor } from '../../lib/pagination.js';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

/** Максимум активных привязок на пользователя: защита от перебора квартир. */
const MAX_ACTIVE_BINDINGS = 10;

export interface ApartmentSearchItem {
  apartmentId: string;
  number: string;
  addressText: string;
  tenantId: string;
  tenantName: string;
  alreadyBound: boolean;
}

/**
 * Поиск квартиры для привязки.
 *
 * Отдаём ТОЛЬКО адрес, номер квартиры и название УК. Ни ФИО жильцов,
 * ни телефонов, ни истории заявок — иначе поиск превращается в способ
 * разведки и утечку персональных данных.
 */
export async function searchApartments(
  userId: string,
  addressQuery: string,
  apartmentNumber: string | null,
): Promise<ApartmentSearchItem[]> {
  const res = await pool.query<{
    id: string;
    number: string;
    address_text: string;
    tenant_id: string;
    tenant_name: string;
    already_bound: boolean;
  }>(
    `SELECT a.id, a.number, b.address_text, t.id AS tenant_id, t.name AS tenant_name,
            EXISTS (
              SELECT 1 FROM resident_bindings rb
               WHERE rb.user_id = $3 AND rb.apartment_id = a.id
                 AND rb.status IN ('pending', 'confirmed')
            ) AS already_bound
       FROM apartments a
       JOIN buildings b ON b.id = a.building_id
       JOIN tenants t ON t.id = a.tenant_id
      WHERE a.deleted_at IS NULL
        AND b.deleted_at IS NULL
        AND t.status = 'active'
        AND b.address_text ILIKE '%' || $1 || '%'
        AND ($2::text IS NULL OR a.number = $2)
      ORDER BY b.address_text, a.number
      LIMIT 10`,
    [addressQuery, apartmentNumber, userId],
  );

  return res.rows.map((r) => ({
    apartmentId: r.id,
    number: r.number,
    addressText: r.address_text,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    alreadyBound: r.already_bound,
  }));
}

export interface CreatedBinding {
  id: string;
  status: string;
  apartmentNumber: string;
  addressText: string;
  tenantName: string;
}

export async function createBinding(
  userId: string,
  apartmentId: string,
  roleInApartment: 'owner' | 'renter' | 'representative',
): Promise<Result<CreatedBinding>> {
  const aptRes = await pool.query<{
    number: string;
    address_text: string;
    tenant_id: string;
    tenant_name: string;
  }>(
    `SELECT a.number, b.address_text, t.id AS tenant_id, t.name AS tenant_name
       FROM apartments a
       JOIN buildings b ON b.id = a.building_id
       JOIN tenants t ON t.id = a.tenant_id
      WHERE a.id = $1 AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND t.status = 'active'
      LIMIT 1`,
    [apartmentId],
  );

  const apt = aptRes.rows[0];
  if (!apt) {
    return { ok: false, code: 'NOT_FOUND', message: 'Квартира не найдена' };
  }

  const countRes = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM resident_bindings
      WHERE user_id = $1 AND status IN ('pending', 'confirmed')`,
    [userId],
  );
  if (Number(countRes.rows[0]?.count ?? 0) >= MAX_ACTIVE_BINDINGS) {
    return {
      ok: false,
      code: 'LIMIT_EXCEEDED',
      message: `Нельзя иметь больше ${MAX_ACTIVE_BINDINGS} привязок. Отзовите лишние.`,
    };
  }

  try {
    const insRes = await pool.query<{ id: string }>(
      `INSERT INTO resident_bindings (tenant_id, user_id, apartment_id, role_in_apartment, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id`,
      [apt.tenant_id, userId, apartmentId, roleInApartment],
    );
    const id = insRes.rows[0]?.id;
    if (!id) return { ok: false, code: 'INTERNAL', message: 'Не удалось создать привязку' };

    return {
      ok: true,
      data: {
        id,
        status: 'pending',
        apartmentNumber: apt.number,
        addressText: apt.address_text,
        tenantName: apt.tenant_name,
      },
    };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return {
        ok: false,
        code: 'ALREADY_EXISTS',
        message: 'Заявка на эту квартиру уже отправлена',
      };
    }
    throw err;
  }
}

/**
 * Отзыв своей привязки.
 *
 * pending — отмена ещё не обработанной заявки;
 * confirmed — «отвязать квартиру»: доступ закрывается сразу.
 * Раньше подтверждённую привязку отозвать было нельзя, но владелец
 * попросил кнопку на экране «Квартира» — без неё он оставался привязанным
 * навсегда и должен был идти в УК.
 */
export interface RevokedBinding {
  status: string;
  apartmentNumber: string;
}

export async function revokeOwnBinding(
  userId: string,
  bindingId: string,
): Promise<Result<RevokedBinding>> {
  const res = await pool.query<{ status: string; number: string }>(
    `SELECT rb.status, a.number
       FROM resident_bindings rb
       JOIN apartments a ON a.id = rb.apartment_id
      WHERE rb.id = $1 AND rb.user_id = $2`,
    [bindingId, userId],
  );
  const row = res.rows[0];
  if (!row) return { ok: false, code: 'NOT_FOUND', message: 'Привязка не найдена' };

  await pool.query('DELETE FROM resident_bindings WHERE id = $1 AND user_id = $2', [
    bindingId,
    userId,
  ]);
  return { ok: true, data: { status: row.status, apartmentNumber: row.number } };
}

// ─── Для сотрудников УК ─────────────────────────────────────────────────────

export interface TenantBindingItem {
  id: string;
  status: string;
  roleInApartment: string;
  requestedAt: string;
  residentName: string;
  residentPhone: string | null;
  apartmentNumber: string;
  addressText: string;
  rejectReason: string | null;
}

export async function listTenantBindings(
  tenantId: string,
  filter: { status?: string | undefined; limit: number; cursor?: string | undefined },
): Promise<{ items: TenantBindingItem[]; nextCursor: string | null }> {
  const cursor = decodeCursor(filter.cursor);

  const res = await pool.query<{
    id: string;
    status: string;
    role_in_apartment: string;
    requested_at: Date;
    created_at: Date;
    full_name: string;
    phone: string | null;
    number: string;
    address_text: string;
    reject_reason: string | null;
  }>(
    `SELECT rb.id, rb.status, rb.role_in_apartment, rb.requested_at, rb.created_at,
            u.full_name, u.phone, a.number, b.address_text, rb.reject_reason
       FROM resident_bindings rb
       JOIN users u ON u.id = rb.user_id
       JOIN apartments a ON a.id = rb.apartment_id
       JOIN buildings b ON b.id = a.building_id
      WHERE rb.tenant_id = $1
        AND ($2::text IS NULL OR rb.status = $2)
        AND (
          $3::timestamptz IS NULL
          OR (rb.created_at, rb.id) < ($3::timestamptz, $4::uuid)
        )
      ORDER BY rb.created_at DESC, rb.id DESC
      LIMIT $5`,
    [
      tenantId,
      filter.status ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      filter.limit + 1,
    ],
  );

  const hasMore = res.rows.length > filter.limit;
  const page = hasMore ? res.rows.slice(0, filter.limit) : res.rows;
  const last = page[page.length - 1];

  return {
    items: page.map((r) => ({
      id: r.id,
      status: r.status,
      roleInApartment: r.role_in_apartment,
      requestedAt: r.requested_at.toISOString(),
      residentName: r.full_name,
      residentPhone: r.phone,
      apartmentNumber: r.number,
      addressText: r.address_text,
      rejectReason: r.reject_reason,
    })),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export async function confirmBinding(
  tenantId: string,
  bindingId: string,
  byUserId: string,
): Promise<Result<null>> {
  const res = await pool.query(
    `UPDATE resident_bindings
        SET status = 'confirmed', confirmed_by = $3, confirmed_at = now(), reject_reason = NULL
      WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
    [bindingId, tenantId, byUserId],
  );

  if ((res.rowCount ?? 0) === 0) {
    const exists = await pool.query('SELECT status FROM resident_bindings WHERE id = $1 AND tenant_id = $2', [
      bindingId,
      tenantId,
    ]);
    if (!exists.rows[0]) {
      return { ok: false, code: 'NOT_FOUND', message: 'Заявка на привязку не найдена' };
    }
    return {
      ok: false,
      code: 'CONFLICT',
      message: 'Эту заявку уже обработали — обновите список',
    };
  }

  return { ok: true, data: null };
}

export async function rejectBinding(
  tenantId: string,
  bindingId: string,
  reason: string,
): Promise<Result<null>> {
  const res = await pool.query(
    `UPDATE resident_bindings
        SET status = 'rejected', reject_reason = $3
      WHERE id = $1 AND tenant_id = $2 AND status = 'pending'`,
    [bindingId, tenantId, reason],
  );

  if ((res.rowCount ?? 0) === 0) {
    const exists = await pool.query('SELECT status FROM resident_bindings WHERE id = $1 AND tenant_id = $2', [
      bindingId,
      tenantId,
    ]);
    if (!exists.rows[0]) {
      return { ok: false, code: 'NOT_FOUND', message: 'Заявка на привязку не найдена' };
    }
    return {
      ok: false,
      code: 'CONFLICT',
      message: 'Эту заявку уже обработали — обновите список',
    };
  }

  return { ok: true, data: null };
}
