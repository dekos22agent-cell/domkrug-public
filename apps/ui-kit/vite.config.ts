import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const toPosix = (url: string): string => url.replace(/\\/g, '/');

const shared = toPosix(fileURLToPath(new URL('../../packages/shared/src', import.meta.url)));
const ui = toPosix(fileURLToPath(new URL('../../packages/ui/src', import.meta.url)));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@shared\//, replacement: `${shared}/` },
      { find: /^@ui\//, replacement: `${ui}/` },
    ],
  },
  server: {
    port: 5176,
    fs: { allow: ['../..'] },
  },
});
