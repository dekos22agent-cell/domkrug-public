/**
 * Разбор потока событий Asterisk (AMI).
 *
 * Вынесено отдельно от сети: протокол текстовый и скучный, но ошибка в разборе
 * выглядит как «звонок не приходит» — и искать её в сокете бессмысленно.
 * Здесь чистые функции: их можно проверить тестом без Asterisk.
 *
 * Формат: события разделяются пустой строкой (\r\n\r\n), внутри — строки
 * «Ключ: Значение». Первая строка соединения — приветствие сервера.
 */

export interface AmiEvent {
  /** Значение поля Event; у ответов на Action его нет. */
  type: string;
  /** Все поля события как есть, с сохранением регистра ключей протокола. */
  fields: Record<string, string>;
}

/** Сколько байт держим в буфере, если событие никак не завершается. */
const MAX_BUFFER = 256 * 1024;

/**
 * Достаёт из буфера все завершённые события.
 *
 * Возвращает разобранные события и остаток — недописанное хвост, который
 * нужно оставить до следующего пакета. Без остатка события терялись бы на
 * границе TCP-сегмента: Asterisk не обязан присылать по одному событию за раз.
 */
export function drainEvents(buffer: string): { events: AmiEvent[]; rest: string } {
  const events: AmiEvent[] = [];
  let rest = buffer;

  // Ищем разделитель блоков. Пустая строка может быть и \r\n\r\n, и \n\n
  // (в тестах удобнее второе), поэтому проверяем оба.
  for (;;) {
    const crlfIndex = rest.indexOf('\r\n\r\n');
    const lfIndex = rest.indexOf('\n\n');

    let cut = -1;
    let cutLength = 0;
    if (crlfIndex >= 0 && (lfIndex < 0 || crlfIndex <= lfIndex)) {
      cut = crlfIndex;
      cutLength = 4;
    } else if (lfIndex >= 0) {
      cut = lfIndex;
      cutLength = 2;
    }

    if (cut < 0) break;

    const block = rest.slice(0, cut);
    rest = rest.slice(cut + cutLength);

    const parsed = parseBlock(block);
    if (parsed) events.push(parsed);
  }

  // Защита от мусора: если «событие» не кончается, буфер не должен расти вечно
  if (rest.length > MAX_BUFFER) rest = '';

  return { events, rest };
}

/** Один блок «Ключ: Значение» в событие. Пустые и служебные строки пропускаем. */
export function parseBlock(block: string): AmiEvent | null {
  const fields: Record<string, string> = {};

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;

    const colon = line.indexOf(':');
    if (colon <= 0) continue;

    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!key) continue;

    fields[key] = value;
  }

  const type = fields['Event'];
  if (!type) return null;

  return { type, fields };
}

/**
 * Звонок с панели: событие `Newchannel` в контексте `from-panel`.
 *
 * Зачем отдельная функция: у Asterisk на один звонок приходит несколько
 * событий (`Newchannel`, `Newstate`, `Dial`…), и если реагировать на все,
 * в журнале появится три звонка вместо одного. Реагируем ровно на создание
 * канала в нашем контексте.
 */
export interface PanelCall {
  uniqueId: string;
  /** Номер комнаты, который набрала панель (Exten). */
  room: string;
  /** Кто звонит: у панели это её SIP-номер, например 6001. */
  from: string;
  /** Имя канала Asterisk — нужно, чтобы положить трубку после открытия. */
  channel: string | null;
}

export function parsePanelCall(event: AmiEvent): PanelCall | null {
  if (event.type !== 'Newchannel') return null;
  if (event.fields['Context'] !== 'from-panel') return null;

  const uniqueId = event.fields['Uniqueid'];
  const room = event.fields['Exten'];
  if (!uniqueId || !room) return null;

  // Нас интересуют только числовые комнаты: служебные контексты и пустые
  // значения отбрасываем, иначе получим «звонок в неизвестно куда».
  if (!/^\d{1,6}$/.test(room)) return null;

  return {
    uniqueId,
    room,
    from: event.fields['CallerIDNum'] ?? event.fields['ConnectedLineNum'] ?? '',
    channel: event.fields['Channel'] ?? null,
  };
}

/** Завершение звонка: по Uniqueid понимаем, какую запись закрывать. */
export function parseHangup(event: AmiEvent): { uniqueId: string; cause: string } | null {
  if (event.type !== 'Hangup') return null;

  const uniqueId = event.fields['Uniqueid'];
  if (!uniqueId) return null;

  return { uniqueId, cause: event.fields['Cause-txt'] ?? event.fields['Cause'] ?? '' };
}
