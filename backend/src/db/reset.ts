/**
 * Пересоздание схемы (только для разработки).
 *
 * Зачем отдельный скрипт: журнал аудита и история статусов защищены
 * триггерами от DELETE — «просто почистить таблицы» невозможно, и это
 * правильно. Для полного сброса проще удалить схему целиком.
 *
 * ВНИМАНИЕ: удаляет ВСЕ данные в базе. В production не запускать.
 * Защита: скрипт отказывается работать при NODE_ENV=production.
 *
 * После него нужно выполнить:
 *   npm run migrate && npm run db:seed
 */
import { pool } from './pool.js';
import { config } from '../config.js';

async function main(): Promise<void> {
  if (config.isProduction) {
    console.error('[reset] Отказ: NODE_ENV=production. Скрипт удаляет все данные.');
    process.exitCode = 1;
    return;
  }

  console.log('[reset] Удаляю схему public и создаю заново...');
  const client = await pool.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    console.log('[reset] Схема пересоздана.');
    console.log('[reset] Дальше: npm run migrate && npm run db:seed');
  } catch (err) {
    console.error('[reset] Ошибка:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
