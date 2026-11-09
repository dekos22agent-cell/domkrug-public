/**
 * Проверка текстовых полей на «вопросительные знаки» вместо кириллицы.
 *
 * Зачем: один раз это уже случилось. PowerShell 5.1 отправлял тело запроса
 * в ANSI, кириллица заменялась на «?» ещё до отправки, и в базу записались
 * строки вида «????? ????». Нашлось это глазами на скриншоте — слишком поздно.
 *
 * Признак порчи: два и более подряд идущих «?» в тексте. В обычной русской
 * речи такой последовательности не бывает, а в испорченной — сколько угодно.
 *
 * Запуск: npm run check:text
 * Код возврата 1, если найдены подозрительные записи — годится для CI.
 */
import { pool } from './pool.js';

interface Finding {
  table: string;
  column: string;
  count: number;
  samples: string;
}

/** Поля, в которые попадает текст от пользователя или теста. */
const CHECKS: { table: string; column: string; label: string }[] = [
  { table: 'tickets', column: 'title', label: 'заявка: тема' },
  { table: 'tickets', column: 'description', label: 'заявка: описание' },
  { table: 'tickets', column: 'resolution_note', label: 'заявка: что сделано' },
  { table: 'ticket_comments', column: 'body', label: 'комментарий' },
  { table: 'news', column: 'title', label: 'новость: заголовок' },
  { table: 'news', column: 'body', label: 'новость: текст' },
  { table: 'ticket_categories', column: 'name', label: 'категория' },
  { table: 'buildings', column: 'address_text', label: 'адрес дома' },
  { table: 'users', column: 'full_name', label: 'ФИО' },
];

async function main(): Promise<void> {
  const findings: Finding[] = [];

  for (const check of CHECKS) {
    // Регулярка на два и более «?» подряд
    const sql = `
      SELECT count(*)::int AS count,
             string_agg(DISTINCT left(coalesce(${check.column}, ''), 40), ' | ') AS samples
        FROM ${check.table}
       WHERE ${check.column} ~ '\\?\\?'
    `;
    try {
      const res = await pool.query<{ count: number; samples: string | null }>(sql);
      const row = res.rows[0];
      if (row && row.count > 0) {
        findings.push({
          table: check.table,
          column: check.column,
          count: row.count,
          samples: row.samples ?? '',
        });
      }
    } catch (err) {
      // Таблицы может не быть на ранней стадии миграций — это не ошибка проверки
      console.warn(`[check:text] пропущено ${check.table}.${check.column}: ${(err as Error).message}`);
    }
  }

  if (findings.length === 0) {
    console.log('[check:text] ОК: тексты выглядят корректно, «??» не найдены.');
    return;
  }

  console.log('[check:text] НАЙДЕНЫ подозрительные тексты (похоже на потерю кодировки):\n');
  for (const f of findings) {
    console.log(`  ${f.table}.${f.column}: ${f.count} записей`);
    console.log(`    примеры: ${f.samples}\n`);
  }
  console.log('Это не ошибка отображения: такие строки лежат в базе.');
  console.log('Причина обычно в клиенте, который отправил текст не в UTF-8.');
  console.log('Если это демо-данные — проще пересоздать: npm run db:reset && npm run migrate && npm run db:seed');
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[check:text] Ошибка проверки:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
