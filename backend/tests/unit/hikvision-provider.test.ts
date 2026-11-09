/**
 * Тесты Digest-авторизации вызывной панели Hikvision.
 *
 * Зачем отдельно от API-тестов: ошибка в расчёте хеша выглядит как «401 на
 * любой пароль», и в живом стенде её легко спутать с неверной учёткой. Здесь
 * проверка на эталонном векторе из RFC 2617, посчитанном не нашим кодом.
 */
import { describe, expect, it } from 'vitest';
import { buildDigestAuthorization, parseDigestChallenge } from '../../src/modules/access/hikvision-provider.js';

describe('Hikvision ISAPI: Digest', () => {
  it('разбирает challenge с qop и opaque', () => {
    const c = parseDigestChallenge(
      'Digest qop="auth", realm="IP Camera", nonce="abc123", opaque="xyz", stale="FALSE"',
    );
    expect(c).not.toBeNull();
    expect(c?.realm).toBe('IP Camera');
    expect(c?.nonce).toBe('abc123');
    expect(c?.qop).toBe('auth');
    expect(c?.opaque).toBe('xyz');
  });

  it('берёт первый qop из списка', () => {
    const c = parseDigestChallenge('Digest realm="r", nonce="n", qop="auth,auth-int"');
    expect(c?.qop).toBe('auth');
  });

  it('не считает Basic строкой Digest', () => {
    expect(parseDigestChallenge('Basic realm="x"')).toBeNull();
    expect(parseDigestChallenge(null)).toBeNull();
  });

  it('считает response как в эталонном примере RFC 2617', () => {
    // RFC 2617, 3.5: Mufasa / Circle Of Life / GET /dir/index.html
    const header = buildDigestAuthorization({
      user: 'Mufasa',
      password: 'Circle Of Life',
      method: 'GET',
      uri: '/dir/index.html',
      challenge: {
        realm: 'testrealm@host.com',
        nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
        qop: 'auth',
        opaque: null,
      },
      cnonce: '0a4f113b',
      nc: '00000001',
    });
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(header).toContain('nc=00000001');
    expect(header).toContain('cnonce="0a4f113b"');
    expect(header).toContain('uri="/dir/index.html"');
  });

  it('работает без qop (старые прошивки)', () => {
    const header = buildDigestAuthorization({
      user: 'admin',
      password: 'p',
      method: 'PUT',
      uri: '/ISAPI/AccessControl/RemoteControl/door/1',
      challenge: { realm: 'DS', nonce: 'n1', qop: '', opaque: null },
    });
    expect(header).toMatch(/^Digest username="admin"/);
    expect(header).toContain('response="');
    expect(header).not.toContain('qop=');
  });

  it('cnonce по умолчанию разный у двух запросов', () => {
    const challenge = { realm: 'r', nonce: 'n', qop: 'auth', opaque: null };
    const a = buildDigestAuthorization({ user: 'u', password: 'p', method: 'PUT', uri: '/x', challenge });
    const b = buildDigestAuthorization({ user: 'u', password: 'p', method: 'PUT', uri: '/x', challenge });
    expect(a).not.toBe(b);
  });
});
