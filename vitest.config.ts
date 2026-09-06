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
    // better-sqlite3 is a native module. On Windows + Node >= 20, forked workers
    // trip a V8 assertion during native-addon finalization. vmThreads with a single
    // thread per worker gives us process-level isolation without the fork teardown crash.
    pool: 'vmThreads',
    poolOptions: {
      threads: { singleThread: true },
    },
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'apps/**/*.test.ts', 'packages/**/*.test.ts'],
    testTimeout: 20000,
    coverage: { provider: 'v8', reporter: ['text'] },
  },
});
