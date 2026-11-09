/**
 * Разбор событий AMI.
 *
 * Проверяем без Asterisk: протокол простой, но ошибка в разборе выглядит как
 * «звонок не приходит», и искать её в сокете бессмысленно. Здесь же ловятся
 * две реальные ловушки:
 *   - событие может прийти несколькими TCP-пакетами (хвост нельзя терять);
 *   - на один звонок Asterisk присылает несколько событий, реагировать надо
 *     только на создание канала, иначе в журнале будет три звонка.
 */

import { describe, expect, it } from 'vitest';
import {
  drainEvents,
  parseBlock,
  parseHangup,
  parsePanelCall,
} from '../../src/modules/intercom/ami-parser.js';

describe('AMI: разбор потока', () => {
  it('достаёт два события из одного пакета', () => {
    const chunk =
      'Event: Newchannel\r\nUniqueid: 1.1\r\nExten: 100\r\n\r\n' +
      'Event: Hangup\r\nUniqueid: 1.1\r\n\r\n';

    const { events, rest } = drainEvents(chunk);

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('Newchannel');
    expect(events[1]?.type).toBe('Hangup');
    expect(rest).toBe('');
  });

  it('недописанное событие оставляет в остатке, а не теряет', () => {
    const chunk = 'Event: Newchannel\r\nUniqueid: 1.1\r\nExten: 10';

    const { events, rest } = drainEvents(chunk);

    expect(events).toHaveLength(0);
    expect(rest).toContain('Uniqueid: 1.1');
  });

  it('склеивает событие, разорванное на два пакета', () => {
    const first = drainEvents('Event: Newchannel\r\nUniqueid: 1.1\r\n');
    const second = drainEvents(first.rest + 'Exten: 100\r\n\r\n');

    expect(first.events).toHaveLength(0);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]?.fields['Exten']).toBe('100');
  });

  it('понимает разделитель из одного \\n (так удобнее в тестах и логах)', () => {
    const { events } = drainEvents('Event: Hangup\nUniqueid: 2.2\n\n');
    expect(events[0]?.fields['Uniqueid']).toBe('2.2');
  });

  it('пропускает блок без поля Event (ответы на Action)', () => {
    const { events } = drainEvents('Response: Success\r\nMessage: Authentication accepted\r\n\r\n');
    expect(events).toHaveLength(0);
  });

  it('не разбирает мусор вместо падения', () => {
    expect(parseBlock('это не протокол')).toBeNull();
    expect(parseBlock('')).toBeNull();
  });
});

describe('AMI: звонок с панели', () => {
  const newChannel = (overrides: Record<string, string> = {}) => ({
    type: 'Newchannel',
    fields: {
      Event: 'Newchannel',
      Context: 'from-panel',
      Exten: '100',
      Uniqueid: '1680000000.5',
      CallerIDNum: '6001',
      ...overrides,
    },
  });

  it('узнаёт звонок в комнату', () => {
    const call = parsePanelCall(newChannel());

    expect(call).not.toBeNull();
    expect(call?.room).toBe('100');
    expect(call?.from).toBe('6001');
    expect(call?.uniqueId).toBe('1680000000.5');
  });

  it('игнорирует чужие контексты (внутренние вызовы Asterisk)', () => {
    expect(parsePanelCall(newChannel({ Context: 'from-app' }))).toBeNull();
    expect(parsePanelCall(newChannel({ Context: 'default' }))).toBeNull();
  });

  it('игнорирует нечисловую комнату', () => {
    expect(parsePanelCall(newChannel({ Exten: 's' }))).toBeNull();
    expect(parsePanelCall(newChannel({ Exten: '' }))).toBeNull();
  });

  it('реагирует только на Newchannel, а не на все события звонка', () => {
    expect(parsePanelCall({ ...newChannel(), type: 'Newstate' })).toBeNull();
    expect(parsePanelCall({ ...newChannel(), type: 'Dial' })).toBeNull();
    expect(parsePanelCall({ ...newChannel(), type: 'Hangup' })).toBeNull();
  });
});

describe('AMI: завершение звонка', () => {
  it('достаёт Uniqueid и причину', () => {
    const result = parseHangup({
      type: 'Hangup',
      fields: { Event: 'Hangup', Uniqueid: '1680000000.5', 'Cause-txt': 'Normal Clearing' },
    });

    expect(result?.uniqueId).toBe('1680000000.5');
    expect(result?.cause).toBe('Normal Clearing');
  });

  it('без Uniqueid ничего не возвращает: закрывать неизвестно что нельзя', () => {
    expect(parseHangup({ type: 'Hangup', fields: { Event: 'Hangup' } })).toBeNull();
  });

  it('чужие события завершением не считает', () => {
    expect(parseHangup({ type: 'Newchannel', fields: { Uniqueid: '1.1' } })).toBeNull();
  });
});
