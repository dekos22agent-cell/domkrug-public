/*
 * Service worker «ДомКруг».
 *
 * Задача узкая: дать оболочку приложения при плохой связи и сделать установку
 * возможной. Данные заявок НЕ кешируются — они персональные и быстро устаревают.
 *
 * Стратегии:
 *   - переходы между страницами (navigation): сначала сеть, при обрыве — оболочка
 *     из кеша. Так после деплоя пользователь сразу получает свежую версию;
 *   - статика (js/css/png/svg/manifest): сначала кеш, обновление в фоне
 *     (stale-while-revalidate). У файлов Vite в имени есть хеш, поэтому
 *     устаревшая копия не может «залипнуть» навсегда;
 *   - /api/** не трогаем вообще: ответы сервера должны быть всегда свежими.
 *
 * Регистрируется только в production-сборке (см. src/main.tsx), чтобы не
 * мешать разработке.
 */

const CACHE = 'domkrug-shell-v1';

/** Минимум для показа оболочки: сам index подтянется в рантайме. */
const PRECACHE = ['/', '/manifest.webmanifest', '/icon-192.png', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll падает целиком, если хотя бы один файл недоступен,
      // поэтому каждый кладём отдельно и не валим установку из-за одного.
      .then((cache) =>
        Promise.all(
          PRECACHE.map((url) =>
            cache.add(url).catch(() => {
              /* не критично: подтянется при первом запросе */
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Только GET и только свой origin
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API не кешируем: данные должны быть всегда актуальными
  if (url.pathname.startsWith('/api/')) return;

  // Переход по страницам — сеть в приоритете
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('/');
          return (
            cached ??
            new Response(
              '<!doctype html><meta charset="utf-8"><title>Нет связи</title>' +
                '<p style="font:16px system-ui;padding:24px">Нет соединения. ' +
                'Проверьте интернет и обновите страницу.</p>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
            )
          );
        }),
    );
    return;
  }

  // Статика — кеш + фоновое обновление
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached ?? network;
    }),
  );
});
