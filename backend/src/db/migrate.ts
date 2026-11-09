/**
 * Простой раннер SQL-миграций.
 *
 * Почему не ORM-миграции: миграции — это схема БД, и она должна быть
 * читаемым SQL, а не сгенерированным кодом. Один файл = одна миграция,
 * применяется ровно один раз, в транзакции.
 *
 * Применённые миграции фиксируются в таблице `schema_migrations` вместе с
 * SHA-256 контрольной суммой файла. Если уже применённый файл изменили,
 * деплой падает: иначе схема на разных стендах молча разъезжается.
 *
 * Блокировка: pg_advisory_lock — защита от двух параллельных запусков.
 * Важно: advisory lock привязан к СОЕДИНЕНИЮ, поэтому берём один клиент из
 * пула и на нём же выполняем миграции и снимаем блокировку. `pool.query()`
 * между lock/unlock мог бы взять другое соединение.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { pool } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// backend/src/db или backend/dist/db → ../../migrations = backend/migrations
const MIGRATIONS_DIR = path.resolve(here, '../../migrations');

const LOCK_KEY = 727_001; // произвольное, но постоянное число

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          text        PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer     NOT NULL DEFAULT 0,
      checksum    text
    )
  `);
  // Совместимость с базой, где таблица была создана до появления checksum.
  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
}

async function appliedMigrations(client: PoolClient): Promise<Map<string, string | null>> {
  const { rows } = await client.query<{ id: string; checksum: string | null }>(
    'SELECT id, checksum FROM schema_migrations',
  );
  return new Map(rows.map((row) => [row.id, row.checksum]));
}

async function main(): Promise<void> {
  console.log('[migrate] Подключение к БД...');

  // Проверяем соединение до блокировки, чтобы дать понятную ошибку.
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('[migrate] Не удалось подключиться к базе.');
    console.error(`[migrate] DATABASE_URL: ${maskUrl(process.env['DATABASE_URL'] ?? '')}`);
    console.error('[migrate] Проверьте, что PostgreSQL запущен: docker compose up -d postgres');
    console.error(`[migrate] Причина: ${describeError(err)}`);
    process.exitCode = 1;
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureMigrationsTable(client);
    const done = await appliedMigrations(client);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.warn(`[migrate] В ${MIGRATIONS_DIR} нет .sql файлов.`);
      return;
    }

    let applied = 0;
    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      const sum = checksum(sql);

      if (done.has(file)) {
        const stored = done.get(file);
        if (stored && stored !== sum) {
          console.error(
            `[migrate] ✗ ${file}: контрольная сумма не совпадает. ` +
              'Файл уже применённой миграции изменён — это ломает схему на стендах.',
          );
          process.exitCode = 1;
          return;
        }
        if (!stored) {
          // Старые строки без checksum: запоминаем текущий, не выполняя SQL.
          await client.query('UPDATE schema_migrations SET checksum = $2 WHERE id = $1', [file, sum]);
        }
        console.log(`[migrate] = ${file} (уже применена)`);
        continue;
      }

      const started = performance.now();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        const ms = Math.round(performance.now() - started);
        await client.query(
          'INSERT INTO schema_migrations (id, duration_ms, checksum) VALUES ($1, $2, $3)',
          [file, ms, sum],
        );
        await client.query('COMMIT');
        applied += 1;
        console.log(`[migrate] + ${file} — применена за ${ms} мс`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[migrate] ✗ ${file} — ОШИБКА, откат транзакции`);
        console.error(`[migrate] ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }
    }

    console.log(
      applied === 0
        ? '[migrate] Всё актуально, новых миграций нет.'
        : `[migrate] Готово: применено ${applied}.`,
    );
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(не задан или некорректен)';
  }
}

/**
 * Понятное описание ошибки подключения.
 *
 * Драйвер `pg` при отказе в соединении бросает AggregateError, у вложенных
 * ошибок сообщение может быть пустым — остаётся только код (ECONNREFUSED).
 * Без этого мы печатали «Причина: » и пустоту.
 */
function describeError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) {
    return err.errors
      .map((inner) => {
        const e = inner as NodeJS.ErrnoException;
        return [e.code, e.message].filter(Boolean).join(': ') || String(inner);
      })
      .join('; ');
  }
  const e = err as NodeJS.ErrnoException;
  return [e.code, e.message].filter(Boolean).join(': ') || String(err);
}

main()
  .catch((err) => {
    console.error('[migrate] Неожиданная ошибка:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
