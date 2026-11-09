/**
 * Проверка СНИЛС.
 *
 * Зачем проверять: без проверки контрольной суммы человек может опечататься
 * и получить номер, которого не существует. Тогда сверка с реестром УК
 * не сработает, и мы будем искать ошибку не там.
 *
 * Формат: 11 цифр. Последние две — контрольное число, рассчитанное по первым
 * девяти. Номера меньше 001-001-998 не выдавались (это резерв), поэтому
 * считаются недействительными.
 *
 * Хранение: только цифры, без дефисов и пробелов. «123-456-789 01» и
 * «12345678901» — один и тот же номер, и в базе они должны совпадать.
 */

/** Убирает всё, кроме цифр: человек может вставить номер с дефисами. */
export function normalizeSnils(input: string): string {
  return input.replace(/\D/g, '');
}

/** Форматирует для показа: 12345678901 → 123-456-789 01 */
export function formatSnils(digits: string): string {
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)} ${digits.slice(9)}`;
}

/**
 * Проверяет СНИЛС и возвращает причину отказа либо null, если всё верно.
 */
export function validateSnils(input: string): string | null {
  const digits = normalizeSnils(input);

  if (digits.length !== 11) {
    return 'СНИЛС — 11 цифр';
  }

  const number = digits.slice(0, 9);
  const checksum = Number(digits.slice(9));

  // Номера из зарезервированного диапазона не выдавались
  if (Number(number) < 1_001_998) {
    return 'Такой номер СНИЛС не выдавался';
  }

  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(number[index]) * (9 - index);
  }

  // Правило контрольного числа: остаток от деления на 101,
  // при 100 и 101 контрольное число равно 0.
  let expected = sum < 100 ? sum : sum % 101;
  if (expected === 100 || expected === 101) expected = 0;

  if (expected !== checksum) {
    return 'СНИЛС не прошёл проверку контрольной суммы — проверьте номер';
  }

  return null;
}
