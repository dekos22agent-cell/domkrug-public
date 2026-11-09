/**
 * Курсорная пагинация.
 *
 * Offset-пагинация «плывёт»: пока пользователь листает, добавляются новые
 * записи, и страницы начинают дублироваться и пропускаться. Курсор по
 * (created_at, id) даёт стабильный порядок.
 *
 * Курсор — base64 от JSON, но это НЕ защита от подделки: клиент может
 * прислать любой. Внутри только created_at и id, никаких данных УК,
 * поэтому подделка курсора не даёт доступа к чужим записям — фильтр
 * по tenant_id всё равно применяется в запросе.
 */
export interface Cursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: createdAt.toISOString(), i: id }), 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const obj = parsed as { t?: unknown; i?: unknown };
    if (typeof obj.t !== 'string' || typeof obj.i !== 'string') return null;
    if (Number.isNaN(Date.parse(obj.t))) return null;
    return { createdAt: obj.t, id: obj.i };
  } catch {
    return null;
  }
}

/** Ограничение размера страницы: защита от limit=100000. */
export function clampLimit(value: unknown, def = 20, max = 100): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}
