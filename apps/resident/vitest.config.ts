import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Тесты живут и в приложении, и в общих пакетах: чистая логика (формат дат)
// переехала в packages/shared, но проверяться должна тем же прогоном.
export default defineConfig({
  test: {
    include: [
      'src/**/*.test.{ts,tsx}',
      fileURLToPath(new URL('../../packages/shared/src/**/*.test.{ts,tsx}', import.meta.url)).replace(/\\/g, '/'),
      fileURLToPath(new URL('../../packages/ui/src/**/*.test.{ts,tsx}', import.meta.url)).replace(/\\/g, '/'),
    ],
  },
})
