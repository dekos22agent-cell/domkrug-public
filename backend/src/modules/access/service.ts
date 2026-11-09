/**
 * Доступ к точкам: проверка прав, вызов провайдера, журнал.
 *
 * Правила:
 *  - право выводится из подтверждённой привязки к квартире и выданного
 *    квартире доступа, а не хранится отдельно у человека;
 *  - чужая точка неотличима от несуществующей: отвечаем 404 в обоих случаях,
 *    чтобы перебором нельзя было узнать, какие шлагбаумы есть в доме;
 *  - отказы тоже пишутся в журнал: по ним видно проблемы прав, а не только
 *    успешные нажатия;
 *  - ограничение частоты: без него кнопку можно «зажать», и дверь будет
 *    дёргаться. Пять открытий в минуту — достаточно и человеку, и гостю.
 */
import { pool } from '../../db/pool.js';
import { HikvisionAccessProvider } from './hikvision-provider.js';
import { MockAccessProvider } from './mock-provider.js';
import type { AccessPointInfo, AccessProvider, AccessPointKind } from './provider.js';

/** Реестр провайдеров. Новый вендор — новый класс и строка здесь. */
const providers: Record<string, AccessProvider> = {
  mock: new MockAccessProvider(),
  hikvision: new HikvisionAccessProvider(),
};

function providerFor(name: string): AccessProvider {
  return providers[name] ?? providers['mock']!;
}

export interface ResidentAccessPoint {
  id: string;
  kind: AccessPointKind;
  name: string;
  instruction: string | null;
  buildingId: string;
  buildingAddress: string;
  apartmentId: string;
  apartmentNumber: string;
  isActive: boolean;
}

interface PointRow {
  id: string;
  kind: AccessPointKind;
  name: string;
  instruction: string | null;
  provider: string;
  /** Номер реле/двери внутри устройства; null — провайдер возьмёт значение по умолчанию. */
  provider_ref: string | null;
  is_active: boolean;
  building_id: string;
  address_text: string;
  apartment_id: string;
  apartment_number: string;
  /** Есть только в запросе открытия: владелец или набор прав члена. */
  is_owner?: boolean;
  scopes?: string[];
}

/**
 * Точки, доступные жителю.
 *
 * Соединяем подтверждённые привязки → квартиры → выданные доступы → точки.
 * Если у человека две квартиры в разных УК, он увидит точки обеих.
 */
export async function listPointsForUser(userId: string): Promise<ResidentAccessPoint[]> {
  // DISTINCT ON: у жителя с двумя квартирами в одном доме одна и та же дверь
  // иначе попадёт в список дважды. Показываем точку один раз и привязываем
  // к первой подходящей квартире.
  const res = await pool.query<PointRow>(
    `SELECT * FROM (
       SELECT DISTINCT ON (ap.id)
              ap.id, ap.kind, ap.name, ap.instruction, ap.provider, ap.is_active,
              ap.building_id,
              b.address_text,
              a.id AS apartment_id,
              a.number AS apartment_number,
              ap.sort_order
         FROM apartment_rights r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         JOIN access_grants g ON g.apartment_id = a.id AND g.revoked_at IS NULL
         JOIN access_points ap ON ap.id = g.access_point_id
        WHERE r.user_id = $1
          AND r.can_open
          AND (
            r.is_owner
            OR 'access.open' = ANY (r.scopes)
            OR ('access.' || ap.kind) = ANY (r.scopes)
          )
        ORDER BY ap.id, a.number
     ) AS points
     ORDER BY sort_order, name`,
    [userId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    instruction: row.instruction,
    buildingId: row.building_id,
    buildingAddress: row.address_text,
    apartmentId: row.apartment_id,
    apartmentNumber: row.apartment_number,
    isActive: row.is_active,
  }));
}

export type OpenPointOutcome =
  | { ok: true; message: string; holdSeconds?: number; openedAt: string }
  | { ok: false; status: 404 | 403 | 429 | 502; code: string; message: string };

interface OpenPointInput {
  userId: string;
  pointId: string;
  source: 'app' | 'widget' | 'staff' | 'auto';
}

/** Сколько открытий в минуту разрешаем одному человеку. */
const OPEN_LIMIT_PER_MINUTE = 5;

export async function openAccessPoint({
  userId,
  pointId,
  source,
}: OpenPointInput): Promise<OpenPointOutcome> {
  // 1. Право: точка должна быть выдана квартире, где человек подтверждён
  const found = await pool.query<PointRow>(
    `SELECT ap.id, ap.kind, ap.name, ap.instruction, ap.provider, ap.provider_ref,
            ap.is_active,
            ap.building_id,
            b.address_text,
            a.id AS apartment_id,
            a.number AS apartment_number,
            r.is_owner, r.scopes
       FROM apartment_rights r
       JOIN apartments a ON a.id = r.apartment_id
       JOIN buildings b ON b.id = a.building_id
       JOIN access_grants g ON g.apartment_id = a.id AND g.revoked_at IS NULL
       JOIN access_points ap ON ap.id = g.access_point_id
      WHERE r.user_id = $1
        AND r.can_open
        AND ap.id = $2
      LIMIT 1`,
    [userId, pointId],
  );

  const row = found.rows[0];
  if (!row) {
    // Нет точки или нет права — один и тот же ответ
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Точка доступа не найдена' };
  }

  // Конкретный тип точки: член семьи мог получить только калитку или
  // только шлагбаум. access.open означает «все точки» (старые приглашения)
  const allowedByKind =
    row.is_owner === true ||
    (row.scopes ?? []).includes('access.open') ||
    (row.scopes ?? []).includes(`access.${row.kind}`);
  if (!allowedByKind) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Точка доступа не найдена' };
  }

  // 2. Точка может быть отключена (ремонт, замена замка)
  if (!row.is_active) {
    await writeEvent({
      tenantId: null,
      pointId,
      userId,
      apartmentId: row.apartment_id,
      result: 'denied',
      source,
      detail: { reason: 'point_disabled' },
    });
    return {
      ok: false,
      status: 403,
      code: 'POINT_DISABLED',
      message: 'Точка доступа временно отключена управляющей компанией',
    };
  }

  // 3. Ограничение частоты: защита от «зажатой» кнопки и от перебора
  const recent = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM access_events
      WHERE user_id = $1 AND result = 'ok' AND created_at > now() - interval '1 minute'`,
    [userId],
  );
  if (Number(recent.rows[0]?.count ?? '0') >= OPEN_LIMIT_PER_MINUTE) {
    await writeEvent({
      tenantId: await tenantOfPoint(pointId),
      pointId,
      userId,
      apartmentId: row.apartment_id,
      result: 'denied',
      source,
      detail: { reason: 'rate_limited' },
    });
    return {
      ok: false,
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Слишком часто. Подождите минуту и попробуйте снова',
    };
  }

  // 4. Команда устройству
  const provider = providerFor(row.provider);
  const point: AccessPointInfo = {
    id: row.id,
    kind: row.kind,
    name: row.name,
    instruction: row.instruction,
    provider: row.provider,
    ref: row.provider_ref,
  };

  let result;
  try {
    result = await provider.open(point);
  } catch (error) {
    await writeEvent({
      tenantId: await tenantOfPoint(pointId),
      pointId,
      userId,
      apartmentId: row.apartment_id,
      result: 'error',
      source,
      detail: { error: error instanceof Error ? error.message : 'unknown' },
    });
    return {
      ok: false,
      status: 502,
      code: 'DEVICE_ERROR',
      message: 'Устройство не отвечает. Попробуйте ещё раз или откройте ключом.',
    };
  }

  await writeEvent({
    tenantId: await tenantOfPoint(pointId),
    pointId,
    userId,
    apartmentId: row.apartment_id,
    result: result.ok ? 'ok' : 'error',
    source,
    detail: result.ok ? { holdSeconds: result.holdSeconds ?? null } : { message: result.message },
  });

  if (!result.ok) {
    return { ok: false, status: 502, code: 'DEVICE_ERROR', message: result.message };
  }

  return {
    ok: true,
    message: result.message,
    ...(result.holdSeconds !== undefined ? { holdSeconds: result.holdSeconds } : {}),
    openedAt: new Date().toISOString(),
  };
}

interface EventInput {
  tenantId: string | null;
  pointId: string;
  userId: string;
  apartmentId: string | null;
  result: 'ok' | 'denied' | 'error';
  source: 'app' | 'widget' | 'staff' | 'auto';
  detail?: Record<string, unknown>;
}

async function writeEvent(input: EventInput): Promise<void> {
  const tenantId = input.tenantId ?? (await tenantOfPoint(input.pointId));
  if (!tenantId) return; // точки нет — писать некуда, и это уже обработано выше
  await pool.query(
    `INSERT INTO access_events
       (tenant_id, access_point_id, user_id, apartment_id, action, result, source, detail)
     VALUES ($1, $2, $3, $4, 'open', $5, $6, $7)`,
    [
      tenantId,
      input.pointId,
      input.userId,
      input.apartmentId,
      input.result,
      input.source,
      input.detail ? JSON.stringify(input.detail) : null,
    ],
  );
}

/** Тенант точки нужен для журнала: у события tenant_id обязателен. */
async function tenantOfPoint(pointId: string): Promise<string | null> {
  const res = await pool.query<{ tenant_id: string }>(
    'SELECT tenant_id FROM access_points WHERE id = $1',
    [pointId],
  );
  return res.rows[0]?.tenant_id ?? null;
}

export interface AccessEventItem {
  id: string;
  /** Кто открывал: имя жителя или метка гостевого доступа */
  actor: string | null;
  pointName: string;
  pointKind: AccessPointKind;
  result: 'ok' | 'denied' | 'error';
  source: string;
  createdAt: string;
}

/** Журнал жителя: только его собственные действия. */
export async function listEventsForUser(userId: string, limit = 20): Promise<AccessEventItem[]> {
  const res = await pool.query<{
    id: string;
    name: string;
    kind: AccessPointKind;
    result: 'ok' | 'denied' | 'error';
    source: string;
    actor: string | null;
    created_at: string;
  }>(
    `SELECT e.id, ap.name, ap.kind, e.result, e.source,
            -- Кто открывал: житель по имени, гость — по метке владельца
            CASE
              WHEN e.user_id IS NOT NULL THEN u.full_name
              WHEN m.id IS NOT NULL THEN COALESCE(m.label, 'гость по коду')
              ELSE NULL
            END AS actor,
            e.created_at::text AS created_at
       FROM access_events e
       JOIN access_points ap ON ap.id = e.access_point_id
       LEFT JOIN users u ON u.id = e.user_id
       -- memberId лежит в detail строкой; проверяем формат, иначе каст упадёт
       LEFT JOIN apartment_members m
              ON m.id = CASE
                          WHEN e.detail->>'memberId' ~ '^[0-9a-fA-F-]{36}$'
                            THEN (e.detail->>'memberId')::uuid
                        END
      -- Открытия по квартирам, которыми человек вправе управлять: иначе
      -- гостевые открытия (у них user_id пустой) в журнале не видны
      WHERE e.user_id = $1
         OR e.apartment_id IN (
              SELECT apartment_id FROM apartment_rights
               WHERE user_id = $1 AND can_open
            )
      ORDER BY e.created_at DESC
      LIMIT $2`,
    [userId, Math.min(limit, 100)],
  );

  return res.rows.map((row) => ({
    id: row.id,
    pointName: row.name,
    pointKind: row.kind,
    result: row.result,
    source: row.source,
    actor: row.actor,
    createdAt: row.created_at,
  }));
}

/* ─── Гостевой доступ по коду ───────────────────────────────────────────────
   Тот же провайдер и тот же журнал, но без пользователя: у гостя нет
   учётной записи и персональных данных — только членство с правами. */

export interface GuestPoint {
  id: string;
  kind: AccessPointKind;
  name: string;
  instruction: string | null;
  buildingAddress: string;
}

export async function guestListPoints(
  apartmentId: string,
  scopes: string[] = ['access.open'],
): Promise<GuestPoint[]> {
  const res = await pool.query<{
    id: string;
    kind: AccessPointKind;
    name: string;
    instruction: string | null;
    address_text: string;
  }>(
    `SELECT DISTINCT ON (ap.id) ap.id, ap.kind, ap.name, ap.instruction, b.address_text
       FROM access_grants g
       JOIN access_points ap ON ap.id = g.access_point_id AND ap.is_active
       JOIN buildings b ON b.id = ap.building_id
      WHERE g.apartment_id = $1 AND g.revoked_at IS NULL
        AND (
          'access.open' = ANY ($2::text[])
          OR ('access.' || ap.kind) = ANY ($2::text[])
        )
      ORDER BY ap.id, ap.sort_order`,
    [apartmentId, scopes],
  );

  return res.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    instruction: row.instruction,
    buildingAddress: row.address_text,
  }));
}

/**
 * Открыть точку гостю.
 *
 * Проверяем: точка выдана этой квартире, точка активна, лимит нажатий
 * не превышен. В журнале пишем без user_id — гостя в системе нет, есть
 * только членство и его метка («Строитель Пётр»).
 */
export async function guestOpenPoint(
  apartmentId: string,
  pointId: string,
  memberId: string,
  scopes: string[] = ['access.open'],
): Promise<OpenPointOutcome> {
  const found = await pool.query<{ id: string; kind: AccessPointKind; name: string; provider: string; is_active: boolean; tenant_id: string }>(
    `SELECT ap.id, ap.kind, ap.name, ap.provider, ap.is_active, ap.tenant_id
       FROM access_grants g
       JOIN access_points ap ON ap.id = g.access_point_id
      WHERE g.apartment_id = $1 AND g.revoked_at IS NULL AND ap.id = $2
      LIMIT 1`,
    [apartmentId, pointId],
  );

  const row = found.rows[0];
  if (!row) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Точка доступа не найдена' };
  // Код мог быть выдан только на калитку или только на шлагбаум
  if (!scopes.includes('access.open') && !scopes.includes(`access.${row.kind}`)) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Точка доступа не найдена' };
  }
  if (!row.is_active) {
    return { ok: false, status: 403, code: 'POINT_DISABLED', message: 'Точка временно отключена' };
  }

  // Лимит общий на членство: 10 открытий в минуту хватает и гостю, и строителю
  const recent = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM access_events
      WHERE access_point_id = $1 AND result = 'ok' AND created_at > now() - interval '1 minute'`,
    [pointId],
  );
  if (Number(recent.rows[0]?.count ?? '0') >= 10) {
    return { ok: false, status: 429, code: 'TOO_MANY_REQUESTS', message: 'Слишком часто, подождите минуту' };
  }

  const provider = providerFor(row.provider);
  let result;
  try {
    result = await provider.open({
      id: row.id,
      kind: row.kind,
      name: row.name,
      instruction: null,
      provider: row.provider,
    });
  } catch {
    await pool.query(
      `INSERT INTO access_events (tenant_id, access_point_id, user_id, apartment_id, action, result, source, detail)
       VALUES ($1, $2, NULL, $3, 'open', 'error', 'app', $4)`,
      [row.tenant_id, pointId, apartmentId, JSON.stringify({ memberId })],
    );
    return { ok: false, status: 502, code: 'DEVICE_ERROR', message: 'Устройство не отвечает' };
  }

  await pool.query(
    `INSERT INTO access_events (tenant_id, access_point_id, user_id, apartment_id, action, result, source, detail)
     VALUES ($1, $2, NULL, $3, 'open', $4, 'app', $5)`,
    [
      row.tenant_id,
      pointId,
      apartmentId,
      result.ok ? 'ok' : 'error',
      JSON.stringify({ memberId }),
    ],
  );

  if (!result.ok) {
    return { ok: false, status: 502, code: 'DEVICE_ERROR', message: result.message };
  }

  return {
    ok: true,
    message: result.message,
    ...(result.holdSeconds !== undefined ? { holdSeconds: result.holdSeconds } : {}),
    openedAt: new Date().toISOString(),
  };
}