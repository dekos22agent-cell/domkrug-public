/**
 * Разбор длительностей вида «15m», «30d» в миллисекунды.
 *
 * Нужен, чтобы срок жизни cookie и срок жизни сессии в БД считались
 * из одного места (.env), а не дублировались константами по коду.
 */
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Неверный формат длительности: "${value}". Ожидается, например, 15m или 30d.`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? 'm';
  const factor = UNIT_MS[unit];
  if (!factor) throw new Error(`Неизвестная единица времени: "${unit}"`);
  return amount * factor;
}
