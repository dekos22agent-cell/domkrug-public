/**
 * Wildcard-поддомены: валидатор для Caddy и публичное имя УК.
 *
 * Без валидатора Caddy выпустил бы сертификат на любой поддомен liviti.ru —
 * это позволило бы выдать себя за управляющую компанию. Проверяем, что slug
 * существует и активен.
 */
import { describe, expect, it } from 'vitest';
import { ApiClient, errorCode } from './helpers.js';

describe('Wildcard поддомены', () => {
  it('Caddy получает «можно» только для существующих УК', async () => {
    const client = new ApiClient();

    const allowed = await client.get<{ allowed: boolean; slug: string }>(
      '/internal/tls/allow?domain=dom-service.liviti.ru',
    );
    expect(allowed.status).toBe(200);
    expect(allowed.data?.allowed).toBe(true);
    expect(allowed.data?.slug).toBe('dom-service');

    const zhilkomfort = await client.get('/internal/tls/allow?domain=zhilkomfort.liviti.ru');
    expect(zhilkomfort.status).toBe(200);

    // Служебные хосты живут в том же wildcard-блоке и тоже получают сертификат
    for (const domain of ['app.liviti.ru', 'uk.liviti.ru', 'www.liviti.ru']) {
      const service = await client.get<{ allowed: boolean; service?: boolean }>(
        `/internal/tls/allow?domain=${encodeURIComponent(domain)}`,
      );
      expect(service.status, domain).toBe(200);
      expect(service.data?.allowed, domain).toBe(true);
      expect(service.data?.service, domain).toBe(true);
    }

    const cases: string[] = [
      'api.liviti.ru',
      'mail.liviti.ru',
      'ftp.liviti.ru',
      'doesnotexist-xyz.liviti.ru',
      'dom-service.liviti.ru.evil.com',
      'evil.com',
      'liviti.ru',
    ];
    for (const domain of cases) {
      const denied = await client.get(
        `/internal/tls/allow?domain=${encodeURIComponent(domain)}`,
      );
      expect(denied.status, domain).toBe(403);
      expect(errorCode(denied.data), domain).toBe('DOMAIN_NOT_ALLOWED');
    }
  });

  it('публичный справочник отдаёт имя УК по slug', async () => {
    const client = new ApiClient();

    const res = await client.get<{ slug: string; name: string }>(
      '/public/tenant?slug=dom-service',
    );
    expect(res.status).toBe(200);
    expect(res.data?.slug).toBe('dom-service');
    expect(res.data?.name).toContain('Дом-Сервис');

    const missing = await client.get('/public/tenant?slug=doesnotexist');
    expect(missing.status).toBe(404);
  });
});
