import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Прокси вместо настройки CORS.
//
// Почему: refresh-токен живёт в httpOnly cookie с SameSite=Strict. Если фронт
// (5173) и API (3000) — разные origin, браузер не отправит cookie. Настраивать
// Access-Control-Allow-Credentials и SameSite=None ради разработки значило бы
// ослабить защиту, которая нужна в проде (docs/DECISIONS.md, 03.11.2026).
//
// С прокси запросы идут с того же origin, cookie работает как в production.

// Общие пакеты лежат вне приложения: один исходник для жителя и УК.
// Отдельная сборка пакетам не нужна — их собирает Vite приложения.
// Слеши приводим к прямым: Rolldown на Windows плохо переваривает
// обратные слеши в подстановке алиаса.
const toPosix = (url: string): string => url.replace(/\\/g, '/')

const shared = toPosix(fileURLToPath(new URL('../../packages/shared/src', import.meta.url)))
const ui = toPosix(fileURLToPath(new URL('../../packages/ui/src', import.meta.url)))

// База задаётся при сборке: пока поддомены не подняты, приложения
// живут на путях /app и /uk главного домена.
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    // Регулярки, а не строки: строковый алиас даёт путь без завершающего
    // слеша, и разрешение вложенных импортов ломается.
    alias: [
      { find: /^@shared\//, replacement: `${shared}/` },
      { find: /^@ui\//, replacement: `${ui}/` },
    ],
  },
  server: {
    port: 5173,
    // Vite по умолчанию не отдаёт файлы выше корня приложения,
    // а общие пакеты как раз там
    fs: { allow: ['../..'] },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
