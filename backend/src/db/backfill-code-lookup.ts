/**
 * Заполнить access_code_lookup у кодов, созданных до миграции 023.
 *
 * Идемпотентно: обрабатывает только строки, где lookup ещё NULL.
 * Код расшифровывается из access_code_sealed (ключ — JWT_SECRET/CODE_SECRET)
 * и превращается в HMAC-ключ для индекса.
 */
import { pool } from './pool.js';
import { openSecret } from '../lib/secrets.js';
import { codeLookup, normalizeCode } from '../modules/members/code-access.js';

async function main(): Promise<void> {
  const res = await pool.query<{ id: string; access_code_sealed: string | null }>(
    `SELECT id, access_code_sealed
       FROM apartment_members
      WHERE kind = 'code' AND access_code_lookup IS NULL`,
  );

  let updated = 0;
  let skipped = 0;
  for (const row of res.rows) {
    const code = openSecret(row.access_code_sealed);
    if (!code) {
      skipped += 1;
      continue;
    }
    await pool.query(
      'UPDATE apartment_members SET access_code_lookup = $2 WHERE id = $1',
      [row.id, codeLookup(normalizeCode(code))],
    );
    updated += 1;
  }

  console.log(`[backfill] обновлено: ${updated}, пропущено (не расшифровались): ${skipped}`);
  await pool.end();
}

void main();
