/**
 * Лифты: список, вызов, сообщение о неисправности.
 *
 * В реальности «вызвать лифт» из приложения почти не имеет смысла — человек
 * стоит у лифта и нажимает кнопку. Но у сценария есть два живых применения:
 *
 *  1. Вызов для гостя или курьера, когда житель не дома.
 *  2. Сообщение о неисправности — вот это нужно по-настоящему: застрял,
 *     не закрываются двери, не работает кнопка.
 *
 * Поэтому вызов реализован как событие в журнале, а неисправность — как
 * событие плюс перевод лифта в статус «неисправен» (это делает УК).
 */
import { pool } from '../../db/pool.js';
import { createTicket } from '../tickets/service.js';

export type LiftStatus = 'ok' | 'maintenance' | 'fault';

export interface ResidentLift {
  id: string;
  number: string;
  status: LiftStatus;
  serviceOrg: string | null;
  lastServiceAt: string | null;
  buildingAddress: string;
  entranceNumber: string | null;
}

export async function listLiftsForUser(userId: string): Promise<ResidentLift[]> {
  const res = await pool.query<{
    id: string;
    number: string;
    status: LiftStatus;
    service_org: string | null;
    last_service_at: string | null;
    address_text: string;
    entrance_number: string | null;
  }>(
    `SELECT DISTINCT l.id, l.number, l.status, l.service_org,
            l.last_service_at::text AS last_service_at,
            b.address_text,
            e.number::text AS entrance_number
       FROM resident_bindings rb
       JOIN apartments a ON a.id = rb.apartment_id
       JOIN buildings b ON b.id = a.building_id
       JOIN lifts l ON l.building_id = b.id
       LEFT JOIN entrances e ON e.id = l.entrance_id
      WHERE rb.user_id = $1 AND rb.status = 'confirmed'
      ORDER BY l.number`,
    [userId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    serviceOrg: row.service_org,
    lastServiceAt: row.last_service_at,
    buildingAddress: row.address_text,
    entranceNumber: row.entrance_number,
  }));
}

export type LiftActionOutcome =
  | { ok: true; kind: 'call' | 'fault'; liftId: string; ticketNumber?: number }
  | { ok: false; status: 404 | 403; code: string; message: string };

async function findLiftForUser(userId: string, liftId: string) {
  const res = await pool.query<{ id: string; tenant_id: string; status: LiftStatus }>(
    `SELECT DISTINCT l.id, l.tenant_id, l.status
       FROM resident_bindings rb
       JOIN apartments a ON a.id = rb.apartment_id
       JOIN lifts l ON l.building_id = a.building_id
      WHERE rb.user_id = $1 AND rb.status = 'confirmed' AND l.id = $2
      LIMIT 1`,
    [userId, liftId],
  );
  return res.rows[0] ?? null;
}

export async function callLift(userId: string, liftId: string): Promise<LiftActionOutcome> {
  const lift = await findLiftForUser(userId, liftId);
  if (!lift) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Лифт не найден' };
  }

  if (lift.status === 'fault') {
    return {
      ok: false,
      status: 403,
      code: 'LIFT_FAULT',
      message: 'Лифт неисправен — вызвать нельзя. Сообщите в аварийную службу.',
    };
  }

  await pool.query(
    `INSERT INTO lift_events (tenant_id, lift_id, kind, created_by) VALUES ($1, $2, 'call', $3)`,
    [lift.tenant_id, liftId, userId],
  );

  return { ok: true, kind: 'call', liftId };
}

/**
 * Сообщение о неисправности лифта.
 *
 * Это не просто запись в журнал: создаётся настоящая заявка, иначе житель
 * пишет в пустоту, а УК не видит обращения в своём инбоксе. Заявка уходит
 * в категорию «Лифтовое оборудование» с аварийным приоритетом.
 *
 * Статус лифта при этом не меняется: один житель не должен объявлять лифт
 * неисправным для всего дома — это решает УК после проверки.
 */
export async function reportLiftFault(
  userId: string,
  liftId: string,
  note: string | null,
): Promise<LiftActionOutcome> {
  const lift = await findLiftForUser(userId, liftId);
  if (!lift) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Лифт не найден' };
  }

  // Данные для заявки: квартира, дом, телефон и категория
  const context = await pool.query<{
    apartment_id: string;
    building_id: string;
    phone: string | null;
    category_id: string | null;
    number: string;
  }>(
    `SELECT rb.apartment_id,
            a.building_id,
            u.phone,
            (SELECT id FROM ticket_categories
              WHERE code = 'elevator' AND (tenant_id = $2 OR tenant_id IS NULL)
              ORDER BY tenant_id NULLS LAST LIMIT 1) AS category_id,
            l.number
       FROM resident_bindings rb
       JOIN apartments a ON a.id = rb.apartment_id
       JOIN users u ON u.id = rb.user_id
       JOIN lifts l ON l.id = $3
      WHERE rb.user_id = $1 AND rb.status = 'confirmed'
      LIMIT 1`,
    [userId, lift.tenant_id, liftId],
  );

  const ctx = context.rows[0];
  if (!ctx || !ctx.category_id) {
    return {
      ok: false,
      status: 403,
      code: 'CATEGORY_MISSING',
      message: 'Не удалось создать заявку: категория «Лифтовое оборудование» не настроена',
    };
  }

  // Если текст не написали — всё равно нужно с чем-то работать
  const description = note && note.trim().length >= 5
    ? note.trim()
    : `Сообщение о неисправности лифта №${ctx.number} без подробностей. Требуется проверка.`;

  const created = await createTicket({
    tenantId: lift.tenant_id,
    buildingId: ctx.building_id,
    apartmentId: ctx.apartment_id,
    categoryId: ctx.category_id,
    priority: 'high',
    source: 'resident_app',
    title: `Неисправность лифта №${ctx.number}`,
    description,
    contactPhone: ctx.phone ?? '+70000000000',
    createdBy: userId,
  });

  if (!created.ok) {
    return {
      ok: false,
      status: 403,
      code: created.code,
      message: created.message,
    };
  }

  await pool.query(
    `INSERT INTO lift_events (tenant_id, lift_id, kind, note, created_by, ticket_id)
     VALUES ($1, $2, 'fault', $3, $4, $5)`,
    [lift.tenant_id, liftId, note, userId, created.data.id],
  );

  return { ok: true, kind: 'fault', liftId, ticketNumber: created.data.number };
}

export interface LiftEventItem {
  id: string;
  liftNumber: string;
  kind: 'call' | 'fault' | 'repair';
  note: string | null;
  createdAt: string;
}

export async function listLiftEventsForUser(
  userId: string,
  limit = 20,
): Promise<LiftEventItem[]> {
  const res = await pool.query<{
    id: string;
    number: string;
    kind: 'call' | 'fault' | 'repair';
    note: string | null;
    created_at: string;
  }>(
    `SELECT e.id, l.number, e.kind, e.note, e.created_at::text AS created_at
       FROM lift_events e
       JOIN lifts l ON l.id = e.lift_id
      WHERE e.created_by = $1
      ORDER BY e.created_at DESC
      LIMIT $2`,
    [userId, Math.min(limit, 100)],
  );

  return res.rows.map((row) => ({
    id: row.id,
    liftNumber: row.number,
    kind: row.kind,
    note: row.note,
    createdAt: row.created_at,
  }));
}
