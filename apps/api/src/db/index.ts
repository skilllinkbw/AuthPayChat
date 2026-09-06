/**
 * SQLite access with a migration runner.
 *
 * Every repository function in ../repos takes an explicit owner id and scopes its query by it.
 * That is the SQLite equivalent of Postgres RLS (see db/postgres/002_rls.sql for the
 * production policy set that enforces the same rules inside the database).
 */

import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export type Db = Database.Database;

let instance: Db | null = null;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/**
 * Migration files ship with the bundle (dist/api/migrations). We also fall back to the
 * source tree so the same code runs from `tsx`, from a container image, or from a build.
 */
function migrationsDir(): string {
  const candidates = [
    join(here, 'migrations'),
    join(process.cwd(), 'apps/api/src/db/migrations'),
    join(process.cwd(), 'migrations'),
  ];
  for (const candidate of candidates) {
    try {
      if (readdirSync(candidate).some((f) => f.endsWith('.sql'))) return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error('PayChat: no migration files found');
}

export function migrate(db: Db): void {
  const dir = migrationsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')))');
  for (const file of files) {
    const version = file.replace('.sql', '');
    const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version);
    if (applied) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
  }
}

export function getDb(): Db {
  if (!instance) throw new Error('database not initialised — call initDb() first');
  return instance;
}

export function initDb(path: string): Db {
  instance = openDatabase(path);
  return instance;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

/** For tests: a fresh isolated database. */
export function createTestDb(): Db {
  return openDatabase(':memory:');
}

export function nowIso(): string {
  return new Date().toISOString();
}
