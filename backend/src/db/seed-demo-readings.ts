/**
 * Демо-показания за 12 месяцев.
 *
 * Только для демонстрационных жителей из seed. Скрипт можно запускать
 * повторно: он приводит 12 периодов к одной согласованной шкале.
 */
import { pool } from './pool.js';

const DEMO_PHONES = ['+79000000101', '+79000000105', '+79000000201'];

const WATER = [3.8, 4.1, 3.6, 4.4, 3.9, 4.2, 3.7, 4.0, 4.5, 3.5, 4.3, 3.9];
const ELECTRICITY = [110, 118, 105, 122, 130, 140, 155, 160, 145, 132, 120, 115];

async function main(): Promise<void> {
  const meters = await pool.query<{ id: string; kind: string }>(
    `SELECT DISTINCT m.id, m.kind
       FROM meters m
       JOIN apartments a ON a.id = m.apartment_id AND a.deleted_at IS NULL
       JOIN resident_bindings rb ON rb.apartment_id = a.id AND rb.status = 'confirmed'
       JOIN users u ON u.id = rb.user_id AND u.deleted_at IS NULL
      WHERE u.phone = ANY($1::text[])`,
    [DEMO_PHONES],
  );

  let inserted = 0;
  for (const meter of meters.rows) {
    const base = meter.kind === 'electricity' ? 1450 : 42;
    const deltas = meter.kind === 'electricity' ? ELECTRICITY : WATER;
    let value = base;
    for (let monthsAgo = 12; monthsAgo >= 0; monthsAgo--) {
      value += deltas[Math.min(deltas.length - 1, 12 - monthsAgo)] ?? 0;
      const res = await pool.query(
        `INSERT INTO meter_readings (meter_id, period, value, source)
         VALUES ($1, date_trunc('month', now()) - ($2 || ' months')::interval, $3, 'app')
         ON CONFLICT (meter_id, period) DO UPDATE SET value = EXCLUDED.value`,
        [meter.id, monthsAgo, Number(value.toFixed(1))],
      );
      inserted += res.rowCount ?? 0;
    }
  }

  console.log(`[demo-readings] счётчиков: ${meters.rowCount}, добавлено показаний: ${inserted}`);
  await pool.end();
}

void main();
