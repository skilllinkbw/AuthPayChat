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
    // can trip a V8 assertion during native-addon finalization if the SQLite
    // handle is still open at isolate teardown. tests/setup.ts closes the DB
    // in a top-level afterAll (runs before the worker exits) to prevent that.
    //
    // NOTE: pool: 'vmThreads' does NOT support top-level afterAll/beforeAll in
    // setup files — it throws "Vitest failed to find the current suite" and
    // fails every test file at setup (0 tests run). 'forks' runs the setup
    // lifecycle hooks correctly, so we use it here. run-tests.cjs spawns each
    // test file in its own process and retries once on the residual native crash.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'apps/**/*.test.ts', 'packages/**/*.test.ts'],
    testTimeout: 20000,
    coverage: { provider: 'v8', reporter: ['text'] },
  },
});
