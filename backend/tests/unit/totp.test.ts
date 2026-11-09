import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, stepAt, totpAt, verifyTotp } from '../../src/lib/totp.js';

/**
 * Официальные тестовые векторы RFC 6238 для SHA1.
 * Секрет — ASCII «12345678901234567890» в base32.
 * В RFC коды восьмизначные; для шестизначных берём последние 6 цифр.
 */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP', () => {
  it('кодирует и декодирует base32 без потерь', () => {
    const bytes = Buffer.from('12345678901234567890', 'ascii');
    expect(base32Encode(bytes)).toBe(RFC_SECRET);
    expect(base32Decode(RFC_SECRET).equals(bytes)).toBe(true);
  });

  it('совпадает с векторами RFC 6238', () => {
    const vectors: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ];

    for (const [seconds, expected] of vectors) {
      const step = Math.floor(seconds / 30);
      expect(totpAt(RFC_SECRET, step)).toBe(expected);
    }
  });

  it('принимает соседний шаг и отвергает далёкий, мусор и неверную длину', () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);

    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 3), now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBe(false);
    expect(verifyTotp('НЕ-BASE32', '123456', now)).toBe(false);
  });

  it('сравнение кода не зависит от регистра секрета', () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    const secret = 'gezdgnbvgy3tqojqgezdgnbvgy3tqojq';
    expect(verifyTotp(secret, totpAt(RFC_SECRET, step), now)).toBe(true);
  });
});
