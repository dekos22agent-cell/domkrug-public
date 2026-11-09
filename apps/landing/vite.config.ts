import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Лендинг — статическая страница на главном домене. Общих пакетов не требует:
// это витрина, а не продукт, и тянуть в неё React-компоненты приложения
// незачем.
// Страница 404 берётся из общего пакета: она одинаковая во всех клиентах
const ui = fileURLToPath(new URL('../../packages/ui/src', import.meta.url)).replace(/\\/g, '/')

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: /^@ui\//, replacement: `${ui}/` }] },
  server: {
    port: 5175,
    // Проверка сессии на главной: в dev проксируем API, чтобы cookie
    // работала как на одном origin
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
