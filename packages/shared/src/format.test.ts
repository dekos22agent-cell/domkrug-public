/**
 * Тесты приведения телефона.
 *
 * Функция маленькая, но с несколькими ветками и реальными последствиями:
 * ошибка здесь — это «номер не найден» при входе или отказ регистрации
 * человеку, который ввёл правильный номер в привычном виде.
 */

import { describe, expect, it } from 'vitest';
import { greetingName, normalizePhone, shortAddress } from './format';

describe('normalizePhone', () => {
  it('приводит номер с восьмёрки', () => {
    expect(normalizePhone('89231234567')).toBe('+79231234567');
    expect(normalizePhone('8-923-123-45-67')).toBe('+79231234567');
    expect(normalizePhone('8 (923) 123-45-67')).toBe('+79231234567');
    expect(normalizePhone('8 923 123 45 67')).toBe('+79231234567');
  });

  it('приводит номер с семёрки', () => {
    expect(normalizePhone('79231234567')).toBe('+79231234567');
    expect(normalizePhone('+79231234567')).toBe('+79231234567');
    expect(normalizePhone('+7 923 123-45-67')).toBe('+79231234567');
  });

  it('приводит мобильный без кода страны', () => {
    expect(normalizePhone('9231234567')).toBe('+79231234567');
    expect(normalizePhone('923 123 45 67')).toBe('+79231234567');
  });

  it('не трогает уже нормализованный номер', () => {
    expect(normalizePhone('+79000000101')).toBe('+79000000101');
  });

  it('не трогает e-mail — на экране входа одно поле для обоих', () => {
    expect(normalizePhone('user@example.com')).toBe('user@example.com');
    expect(normalizePhone('  user@example.com  ')).toBe('user@example.com');
  });

  it('не трогает незаконченный ввод', () => {
    expect(normalizePhone('923')).toBe('923');
    expect(normalizePhone('+7 923')).toBe('+7 923');
    expect(normalizePhone('')).toBe('');
  });

  it('снимает форматирование с любого номера с кодом страны', () => {
    // +7 383 123-45-67 и +73831234567 — один и тот же номер.
    // Нормализация убирает скобки и дефисы, а не «делает номер мобильным».
    expect(normalizePhone('+7 (383) 123-45-67')).toBe('+73831234567');
    expect(normalizePhone('8 (383) 123-45-67')).toBe('+73831234567');
  });

  it('не угадывает код страны там, где его нет и он неочевиден', () => {
    // 10 цифр с кодом города без семёрки — двусмысленно, оставляем как есть.
    // Для мобильного такой случай однозначен (начинается с 9) и обрабатывается.
    expect(normalizePhone('3831234567')).toBe('3831234567');
  });

  it('не угадывает там, где цифр больше нужного', () => {
    expect(normalizePhone('+792312345678')).toBe('+792312345678');
  });
});

describe('greetingName', () => {
  it('фамилия первой — берём имя и отчество', () => {
    expect(greetingName('Иванов Иван Иванович')).toBe('Иван Иванович');
  });

  it('имя первым — не путаем фамилию с отчеством', () => {
    expect(greetingName('Иван Петрович Сидоров')).toBe('Иван Петрович');
  });

  it('два слова с отчеством', () => {
    expect(greetingName('Иван Петрович')).toBe('Иван Петрович');
    expect(greetingName('Петрович Иван')).toBe('Иван Петрович');
  });

  it('два слова без отчества: фамилию узнаём по окончанию', () => {
    expect(greetingName('Петров Иван')).toBe('Иван');
    expect(greetingName('Иван Петров')).toBe('Иван');
  });

  it('одно слово и пустое значение', () => {
    expect(greetingName('Анна')).toBe('Анна');
    expect(greetingName('')).toBe('');
    expect(greetingName(null)).toBe('');
  });
});

describe('shortAddress', () => {
  it('убирает город из начала', () => {
    expect(shortAddress('г. Барнаул, ул. Ленина, 1')).toBe('ул. Ленина, 1');
  });

  it('не трогает адрес без города', () => {
    expect(shortAddress('ул. Ленина, 1')).toBe('ул. Ленина, 1');
  });

  it('пустое значение остаётся пустым', () => {
    expect(shortAddress('')).toBe('');
  });
});
