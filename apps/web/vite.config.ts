import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The dev server proxies /api to the PayChat API so the browser never talks to
// a hard-coded localhost origin — it works unchanged on any host.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@paychat/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@paychat/nlp': fileURLToPath(new URL('../../packages/nlp/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        ws: false,
      },
    },
  },
  preview: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  build: {
    outDir: fileURLToPath(new URL('../../dist/web', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
});
