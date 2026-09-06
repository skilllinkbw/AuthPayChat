/**
 * Global vitest test setup.
 *
 *  - Forces PAYCHAT_ENV=test for every worker (defence in depth on top of helpers.ts).
 *  - Ensures the better-sqlite3 database is CLOSED before the worker process exits.
 *    Leaving the SQLite native handle open until isolate disposal triggers a flaky
 *    V8 assertion (`RemoveEnvironmentCleanupHook`) on Node >= 20/Windows, which aborts
 *    whole runs even when every assertion passed.
 */

import { afterAll } from 'vitest';
import { closeDb } from '../apps/api/src/db/index.js';

process.env.PAYCHAT_ENV = 'test';

afterAll(() => {
  try {
    closeDb();
  } catch {
    // Closing is best-effort; nothing user-visible depends on it.
  }
});