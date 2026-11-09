/**
 * Счётчики: список, последние показания, передача.
 *
 * Правила простые, но важные:
 *  - показания принимаются только за текущий и прошлый месяц: за будущее
 *    их не существует, за позапрошлое — уже сформирована квитанция;
 *  - значение не может быть меньше предыдущего: счётчик не крутится назад,
 *    а «исправление» в меньшую сторону — это либо замена прибора, либо
 *    ошибка ввода;
 *  - повторная передача за тот же период исправляет значение, а не создаёт
 *    вторую запись: иначе в квитанции окажется два разных числа.
 */
import { pool } from '../../db/pool.js';

export type MeterKind = 'cold_water' | 'hot_water' | 'electricity' | 'heat' | 'gas';

export interface ResidentMeter {
  id: string;
  kind: MeterKind;
  serial: string | null;
  unit: string;
  verificationDue: string | null;
  /** Показание за прошлый период — для проверки, что новое не меньше */
  lastValue: number | null;
  lastPeriod: string | null;
  /** Передано ли уже за текущий период */
  currentSubmitted: boolean;
  currentValue: number | null;
  apartmentId: string;
  apartmentNumber: string;
  buildingAddress: string;
}

interface MeterRow {
  id: string;
  kind: MeterKind;
  serial: string | null;
  unit: string;
  verification_due: string | null;
  apartment_id: string;
  apartment_number: string;
  address_text: string;
  last_value: string | null;
  last_period: string | null;
  current_value: string | null;
}

/** Первое число текущего месяца — период показаний. */
export function currentPeriod(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/** Первое число прошлого месяца. */
export function previousPeriod(now = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

export async function listMetersForUser(userId: string): Promise<ResidentMeter[]> {
  const res = await pool.query<MeterRow>(
    `SELECT m.id, m.kind, m.serial, m.unit, m.verification_due::text AS verification_due,
            a.id AS apartment_id,
            a.number AS apartment_number,
            b.address_text,
            prev.value::text AS last_value,
            prev.period::text AS last_period,
            cur.value::text AS current_value
       FROM apartment_rights r
       JOIN apartments a ON a.id = r.apartment_id
       JOIN buildings b ON b.id = a.building_id
       JOIN meters m ON m.apartment_id = a.id AND m.is_active
       LEFT JOIN LATERAL (
         SELECT value, period FROM meter_readings r
          WHERE r.meter_id = m.id AND r.period < $2::date
          ORDER BY period DESC LIMIT 1
       ) prev ON true
       LEFT JOIN meter_readings cur ON cur.meter_id = m.id AND cur.period = $2::date
      WHERE r.user_id = $1 AND r.can_meters
      ORDER BY m.sort_order, m.kind`,
    [userId, currentPeriod()],
  );

  return res.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    serial: row.serial,
    unit: row.unit,
    verificationDue: row.verification_due,
    lastValue: row.last_value === null ? null : Number(row.last_value),
    lastPeriod: row.last_period,
    currentSubmitted: row.current_value !== null,
    currentValue: row.current_value === null ? null : Number(row.current_value),
    apartmentId: row.apartment_id,
    apartmentNumber: row.apartment_number,
    buildingAddress: row.address_text,
  }));
}

export type SubmitOutcome =
  | { ok: true; period: string; value: number; updated: boolean }
  | { ok: false; status: 404 | 400 | 409; code: string; message: string };

export async function submitReading(
  userId: string,
  meterId: string,
  value: number,
): Promise<SubmitOutcome> {
  // Право: счётчик должен принадлежать квартире, где человек подтверждён
  const meter = await pool.query<{ id: string; unit: string; last_value: string | null }>(
    `SELECT m.id, m.unit,
            (SELECT value::text FROM meter_readings r
              WHERE r.meter_id = m.id AND r.period < $3::date
              ORDER BY period DESC LIMIT 1) AS last_value
       FROM apartment_rights r
       JOIN meters m ON m.apartment_id = r.apartment_id AND m.is_active
      WHERE r.user_id = $1 AND r.can_meters AND m.id = $2
      LIMIT 1`,
    [userId, meterId, currentPeriod()],
  );

  const row = meter.rows[0];
  if (!row) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Счётчик не найден' };
  }

  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: 'Укажите показание числом' };
  }

  const previous = row.last_value === null ? 0 : Number(row.last_value);
  // Допускаем исправление уже переданного значения за текущий период,
  // но не «уменьшение» относительно прошлого месяца.
  if (value < previous) {
    return {
      ok: false,
      status: 409,
      code: 'VALUE_DECREASED',
      message: `Показание меньше предыдущего (${previous}). Если прибор заменён — сообщите в УК.`,
    };
  }

  const period = currentPeriod();
  const result = await pool.query(
    `INSERT INTO meter_readings (meter_id, period, value, source, created_by)
     VALUES ($1, $2::date, $3, 'app', $4)
     ON CONFLICT (meter_id, period)
     DO UPDATE SET value = EXCLUDED.value, created_by = EXCLUDED.created_by, created_at = now()
     RETURNING (xmax <> 0) AS updated`,
    [meterId, period, value, userId],
  );

  // Округляем до тысячных: numeric(12,3) всё равно хранит три знака,
  // а 46.300000000000004 в ответе выглядит как ошибка расчёта.
  return {
    ok: true,
    period,
    value: Math.round(value * 1000) / 1000,
    updated: Boolean(result.rows[0]?.updated),
  };
}

export interface ReadingHistoryItem {
  period: string;
  value: number;
}

/** История показаний прибора — чтобы житель видел динамику. */
export async function listReadings(
  userId: string,
  meterId: string,
): Promise<ReadingHistoryItem[] | null> {
  const access = await pool.query(
    `SELECT 1 FROM apartment_rights r
       JOIN meters m ON m.apartment_id = r.apartment_id
      WHERE r.user_id = $1 AND r.can_meters AND m.id = $2
      LIMIT 1`,
    [userId, meterId],
  );
  if (access.rowCount === 0) return null;

  const res = await pool.query<{ period: string; value: string }>(
    `SELECT period::text AS period, value::text AS value
       FROM meter_readings WHERE meter_id = $1
      ORDER BY period DESC LIMIT 12`,
    [meterId],
  );
  return res.rows.map((row) => ({ period: row.period, value: Number(row.value) }));
}

// ─── Управление счётчиками со стороны УК ───────────────────────────────────

export interface StaffMeterItem {
  id: string;
  apartmentId: string;
  apartmentNumber: string;
  kind: MeterKind;
  serial: string | null;
  unit: string;
  verificationDue: string | null;
  isActive: boolean;
  lastValue: number | null;
  lastPeriod: string | null;
}

interface StaffMeterRow {
  id: string;
  apartment_id: string;
  apartment_number: string;
  kind: MeterKind;
  serial: string | null;
  unit: string;
  verification_due: string | null;
  is_active: boolean;
  last_value: string | null;
  last_period: string | null;
}

const STAFF_METER_SELECT = `
  SELECT m.id, a.id AS apartment_id, a.number AS apartment_number,
         m.kind, m.serial, m.unit, m.verification_due::text AS verification_due,
         m.is_active,
         last.value::text AS last_value, last.period::text AS last_period
    FROM meters m
    JOIN apartments a ON a.id = m.apartment_id AND a.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT value, period FROM meter_readings r
       WHERE r.meter_id = m.id
       ORDER BY period DESC LIMIT 1
    ) last ON true
   WHERE m.tenant_id = $1 AND a.building_id = $2`;

function mapStaffMeter(row: StaffMeterRow): StaffMeterItem {
  return {
    id: row.id,
    apartmentId: row.apartment_id,
    apartmentNumber: row.apartment_number,
    kind: row.kind,
    serial: row.serial,
    unit: row.unit,
    verificationDue: row.verification_due,
    isActive: row.is_active,
    lastValue: row.last_value === null ? null : Number(row.last_value),
    lastPeriod: row.last_period,
  };
}

export async function listMetersForBuilding(
  tenantId: string,
  buildingId: string,
): Promise<StaffMeterItem[]> {
  const res = await pool.query<StaffMeterRow>(
    `${STAFF_METER_SELECT}
     ORDER BY a.number::text, m.sort_order, m.kind`,
    [tenantId, buildingId],
  );
  return res.rows.map(mapStaffMeter);
}

async function getStaffMeter(
  tenantId: string,
  buildingId: string,
  meterId: string,
): Promise<StaffMeterItem | null> {
  const res = await pool.query<StaffMeterRow>(
    `${STAFF_METER_SELECT} AND m.id = $3 LIMIT 1`,
    [tenantId, buildingId, meterId],
  );
  const row = res.rows[0];
  return row ? mapStaffMeter(row) : null;
}

export interface SaveMeterInput {
  tenantId: string;
  buildingId: string;
  apartmentId: string;
  kind: MeterKind;
  serial: string | null;
  unit: string;
  verificationDue: string | null;
  isActive: boolean;
  initialValue: number | null;
  createdBy: string;
}

export async function createStaffMeter(
  input: SaveMeterInput,
): Promise<StaffMeterItem | 'not_found'> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const apartment = await client.query(
      `SELECT 1 FROM apartments
        WHERE id = $1 AND tenant_id = $2 AND building_id = $3 AND deleted_at IS NULL
        LIMIT 1`,
      [input.apartmentId, input.tenantId, input.buildingId],
    );
    if (apartment.rowCount === 0) {
      await client.query('ROLLBACK');
      return 'not_found';
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO meters
         (tenant_id, apartment_id, kind, serial, unit, verification_due, is_active)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7)
       RETURNING id`,
      [
        input.tenantId,
        input.apartmentId,
        input.kind,
        input.serial?.trim() || null,
        input.unit.trim(),
        input.verificationDue,
        input.isActive,
      ],
    );
    const meterId = inserted.rows[0]?.id;
    if (!meterId) throw new Error('Не удалось создать счётчик');

    if (input.initialValue !== null) {
      await client.query(
        `INSERT INTO meter_readings (meter_id, period, value, source, created_by)
         VALUES ($1, $2::date, $3, 'staff', $4)`,
        [meterId, currentPeriod(), input.initialValue, input.createdBy],
      );
    }

    await client.query('COMMIT');
    const item = await getStaffMeter(input.tenantId, input.buildingId, meterId);
    if (!item) throw new Error('Не удалось прочитать созданный счётчик');
    return item;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateStaffMeter(input: {
  tenantId: string;
  buildingId: string;
  meterId: string;
  kind: MeterKind;
  serial: string | null;
  unit: string;
  verificationDue: string | null;
  isActive: boolean;
}): Promise<StaffMeterItem | null> {
  const res = await pool.query(
    `UPDATE meters m
        SET kind = $3, serial = $4, unit = $5,
            verification_due = $6::date, is_active = $7
       FROM apartments a
      WHERE m.id = $1
        AND m.tenant_id = $2
        AND a.id = m.apartment_id
        AND a.building_id = $8
        AND a.deleted_at IS NULL`,
    [
      input.meterId,
      input.tenantId,
      input.kind,
      input.serial?.trim() || null,
      input.unit.trim(),
      input.verificationDue,
      input.isActive,
      input.buildingId,
    ],
  );
  if ((res.rowCount ?? 0) === 0) return null;
  return getStaffMeter(input.tenantId, input.buildingId, input.meterId);
}

export async function deactivateStaffMeter(
  tenantId: string,
  buildingId: string,
  meterId: string,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE meters m
        SET is_active = false
       FROM apartments a
      WHERE m.id = $1
        AND m.tenant_id = $2
        AND a.id = m.apartment_id
        AND a.building_id = $3`,
    [meterId, tenantId, buildingId],
  );
  return (res.rowCount ?? 0) > 0;
}
