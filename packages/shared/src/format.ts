/**
 * Форматирование для интерфейса.
 *
 * Правило из DESIGN.md: статус обозначается цветом И текстом — никогда только
 * цветом. Часть пользователей не различает оттенки, поэтому функции возвращают
 * пару «подпись + css-переменная цвета».
 */

import type { TicketPriority, TicketStatus } from './types';

/** Статусы заявки: человеческий текст и токен цвета (docs/DESIGN.md п. 2.3). */
const STATUS_META: Record<TicketStatus, { label: string; colorVar: string }> = {
  new: { label: 'Новая', colorVar: '--status-new' },
  accepted: { label: 'Принята', colorVar: '--status-accepted' },
  assigned: { label: 'Назначен исполнитель', colorVar: '--status-assigned' },
  in_progress: { label: 'В работе', colorVar: '--status-progress' },
  waiting: { label: 'Ожидает материалов', colorVar: '--status-waiting' },
  done: { label: 'Выполнена', colorVar: '--status-done' },
  closed: { label: 'Закрыта', colorVar: '--status-closed' },
  rejected: { label: 'Отклонена', colorVar: '--status-rejected' },
};

export function statusLabel(code: TicketStatus | string): string {
  return STATUS_META[code as TicketStatus]?.label ?? String(code);
}

export function statusColor(code: TicketStatus | string): string {
  return `var(${STATUS_META[code as TicketStatus]?.colorVar ?? '--text-muted'})`;
}

/** Срочность заявки. `emergency` — аварийная, красная метка. */
const PRIORITY_META: Record<TicketPriority, { label: string; colorVar: string }> = {
  low: { label: 'Низкая', colorVar: '--text-muted' },
  normal: { label: 'Обычная', colorVar: '--text-secondary' },
  high: { label: 'Высокая', colorVar: '--status-progress' },
  emergency: { label: 'Аварийная', colorVar: '--emergency' },
};

export function priorityLabel(priority: TicketPriority | string): string {
  return PRIORITY_META[priority as TicketPriority]?.label ?? String(priority);
}

export function priorityColor(priority: TicketPriority | string): string {
  return `var(${PRIORITY_META[priority as TicketPriority]?.colorVar ?? '--text-muted'})`;
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Дата: 03.11.2026 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

/** Дата и время: 03.11.2026, 14:05 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

/** Относительное время: «5 минут назад», «вчера». Для лент и списков. */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);

  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн назад`;

  return formatDate(value);
}

/**
 * Телефон для показа: +79000000101 → +7 900 000-01-01
 * Если формат незнакомый — возвращаем как есть, не ломая ввод.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }
  return value;
}

/**
 * Приведение телефона к единому виду +7XXXXXXXXXX.
 *
 * Люди пишут номер как привыкли: `8-923-123-45-67`, `+7 923 123 45 67`,
 * `79231234567`, `9231234567`. Сервер ждёт строго `+7` и 10 цифр, поэтому
 * без приведения половина вводов не проходит валидацию, а на входе номер
 * просто не находится.
 *
 * Правила:
 *   - 11 цифр, начинается с 7 или 8 → +7 и остальные 10;
 *   - 10 цифр, начинается с 9 → +7 и эти 10 (мобильный без кода страны);
 *   - всё остальное (в том числе e-mail и незаконченный ввод) — без изменений.
 *
 * Городской номер с семёркой нормализуется так же: `+7 (383) 123-45-67` и
 * `+73831234567` — один и тот же номер, скобки и дефисы к нему не относятся.
 * А вот 10 цифр без семёрки и без девятки в начале — двусмысленно
 * (`3831234567`), такое не угадываем.
 */
export function normalizePhone(raw: string): string {
  const value = raw.trim();
  if (!value) return value;

  // E-mail не телефон: на экране входа одно поле принимает и то, и другое
  if (value.includes('@')) return value;

  const digits = value.replace(/\D/g, '');

  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits.startsWith('9')) {
    return `+7${digits}`;
  }

  return value;
}

/** Склонение: 1 заявка, 2 заявки, 5 заявок */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Номер заявки для показа: №1042 */
export function formatTicketNumber(number: number): string {
  return `№${number}`;
}

/** Инициалы для аватара-заглушки: «Иванов Иван» → «ИИ» */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}

/**
 * Как обратиться к жителю.
 *
 * Поддерживаем оба порядка ФИО, потому что люди пишут по-разному:
 *   «Иванов Иван Иванович» (фамилия первой) и
 *   «Иван Петрович Сидоров» (имя первым).
 * Ориентир — отчество: у него устойчивые окончания. Если отчество второе,
 * имя первое; если отчество первое, имя второе.
 *
 * Раньше функция всегда брала второе и третье слово, и «Иван Петрович
 * Сидоров» превращался в «Петрович Сидоров». Это заметил владелец.
 */
function isPatronymic(word: string): boolean {
  return /(ович|евич|ич|овна|евна|ична|инична)$/i.test(word);
}

function isSurnameLike(word: string): boolean {
  return /(ов|ев|ёв|ин|ын|ский|цкий|ой|ий|ый|ая|ова|ева|ёва|ина|ына)$/i.test(word);
}

export function greetingName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';

  if (parts.length === 2) {
    const [first, second] = parts;
    // «Иван Петрович» — имя первое, «Петрович Иван» — наоборот.
    // Обращение вежливое: имя + отчество, если отчество есть.
    if (second && isPatronymic(second)) return `${first} ${second}`;
    if (first && isPatronymic(first)) return `${second} ${first}`;
    // «Петров Иван» — фамилия узнаётся по окончанию, имя берём второе
    if (first && second && isSurnameLike(first) && !isSurnameLike(second)) return second;
    // «Иван Петров» и любой неоднозначный случай — первое слово
    return first ?? '';
  }

  // Три и больше слов: ищем отчество среди слов после первого
  const patronymicIndex = parts.findIndex((part, index) => index > 0 && isPatronymic(part));
  if (patronymicIndex > 0) {
    // «Иванов Иван Иванович» → «Иван Иванович»;
    // «Иван Петрович Сидоров» → «Иван Петрович»
    const name = patronymicIndex === 1 ? parts[0] : parts[1];
    const patronymic = parts[patronymicIndex];
    if (name && patronymic) return `${name} ${patronymic}`;
  }

  // Отчества нет — сохраняем прежнее поведение «фамилия, имя, …»
  return parts[1] ?? parts[0] ?? '';
}

/**
 * Адрес без города — для узкого переключателя квартир.
 * «г. Барнаул, ул. Ленина, 1» → «ул. Ленина, 1»: номер квартиры выходит
 * на первый план, а не теряется за одинаковым началом у всех адресов.
 */
export function shortAddress(addressText: string | null | undefined): string {
  const value = (addressText ?? '').trim();
  if (!value) return '';
  return value.replace(/^г\.\s*[^,]+,\s*/i, '').trim() || value;
}


/**
 * Полное обращение для профиля: «Иванов Иван Иванович» как есть.
 * Для приветствия используйте greetingName.
 */
export function shortName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[1]} ${parts[0]}`;
  return parts[0] ?? '';
}
/**
 * СНИЛС для показа: 12345678901 → 123-456-789 01.
 * В базе хранится без разделителей, чтобы сравнение было однозначным.
 */
export function formatSnils(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return value ?? '';
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)} ${digits.slice(9)}`;
}