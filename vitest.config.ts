import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@paychat/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@paychat/nlp': fileURLToPath(new URL('./packages/nlp/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'apps/**/*.test.ts', 'packages/**/*.test.ts'],
    testTimeout: 20000,
    coverage: { provider: 'v8', reporter: ['text'] },
  },
});
