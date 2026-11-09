/**
 * Пул соединений с PostgreSQL.
 *
 * Один экземпляр на процесс. Никаких `new Pool()` в других файлах —
 * иначе кончится лимит соединений и появятся «странные» таймауты.
 */
import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'domkrug-api',
});

pool.on('error', (err) => {
  // Без этого обработчика ошибка пула роняет процесс.
  console.error('[db] Ошибка простаивающего клиента:', err.message);
});

/** Короткий помощник для запросов без транзакции. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const started = performance.now();
  try {
    return await pool.query<T>(text, params as unknown[]);
  } finally {
    const ms = performance.now() - started;
    if (ms > 200) {
      // Медленные запросы видны в логе сразу, а не после жалобы на «тормозит»
      console.warn(`[db] Медленный запрос ${ms.toFixed(0)}ms: ${text.slice(0, 120)}`);
    }
  }
}

/** Проверка живости БД для /health/ready. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
