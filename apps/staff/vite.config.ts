import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Кабинет УК — отдельное приложение, но бэкенд и общие пакеты те же.
// Дев-сервер на 5174: житель занимает 5173, оба могут работать одновременно.
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
    alias: [
      { find: /^@shared\//, replacement: `${shared}/` },
      { find: /^@ui\//, replacement: `${ui}/` },
    ],
  },
  server: {
    port: 5174,
    fs: { allow: ['../..'] },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
