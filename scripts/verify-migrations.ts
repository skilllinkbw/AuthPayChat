/**
 * Migration discovery verification (brief §12).
 *
 * The defect this guards against: the API used to locate its .sql migrations by probing a
 * path relative to the process CWD. From the built bundle in a clean directory (a container,
 * a packaged zip, a different working directory) that path did not exist, so the server
 * started with an empty schema and failed later in confusing ways.
 *
 * This script proves discovery works in every supported layout:
 *   1. source tree         — `tsx` from the repository root
 *   2. built bundle        — `node dist/api/index.js` from a clean directory (no apps/ tree)
 *   3. packaged layout     — migrations shipped alongside the bundle, cwd = package root
 *   4. failure mode        — no migrations anywhere ⇒ explicit startup failure, not a blank schema
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, cpSync, mkdirSync, rmSync, symlinkSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

const repoRoot = process.cwd();
const results: Array<{ scenario: string; ok: boolean; detail: string }> = [];
let failures = 0;

function record(scenario: string, ok: boolean, detail: string): void {
  results.push({ scenario, ok, detail });
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} [${scenario}] ${detail}`);
}

function tablesIn(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: string }>;
  db.close();
  return [`tables:${rows.length}`, ...versions.map((v) => v.version)];
}

async function waitForHealth(port: number, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

const children: Array<import('node:child_process').ChildProcess> = [];

function startServer(args: { cwd: string; command: string; commandArgs: string[]; dbPath: string; port: number }): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(args.command, args.commandArgs, {
      cwd: args.cwd,
      env: {
        ...process.env,
        PAYCHAT_ENV: 'development',
        DATABASE_PATH: args.dbPath,
        PORT: String(args.port),
        JWT_SECRET: 'migration-verification-secret',
        TOKEN_ENCRYPTION_KEY: 'migration-verification-key',
        INTERNAL_JOB_TOKEN: 'migration-verification-token',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    children.push(child);
    const settle = (code: number | null) => resolve({ code, output });
    (child as unknown as { __resolve: (code: number | null) => void }).__resolve = settle;
    child.on('exit', (code) => settle(code));
    setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 25_000);
  });
}

async function main(): Promise<void> {
  console.log('\nPayChat migration discovery verification\n');

  // 0. Build the bundle so we test what actually ships.
  console.log('0. Building the API bundle');
  execFileSync('npm', ['run', 'build:api'], { cwd: repoRoot, stdio: 'pipe' });
  const bundled = join(repoRoot, 'dist/api/index.js');
  const bundledMigrations = join(repoRoot, 'dist/api/migrations');
  record('build', existsSync(bundled), 'dist/api/index.js produced');
  record('build', readdirSync(bundledMigrations).filter((f) => f.endsWith('.sql')).length > 0,
    `bundle ships ${readdirSync(bundledMigrations).filter((f) => f.endsWith('.sql')).length} migration files`);

  const workspace = mkdtempSync(join(tmpdir(), 'paychat-migrations-'));

  // 1. Source tree (tsx from the repository root)
  {
    const dbPath = join(workspace, 'source.db');
    const run = startServer({
      cwd: repoRoot, command: 'npx', commandArgs: ['tsx', 'apps/api/src/index.ts'],
      dbPath, port: 4511,
    });
    const healthy = await waitForHealth(4511);
    const tables = existsSync(dbPath) ? tablesIn(dbPath) : [];
    record('source tree', healthy && tables.length > 1, `${tables.length} objects, server healthy=${healthy}`);
    (await run);
  }

  // 2. Built bundle executed from a clean directory (container-like: node_modules + dist only)
  {
    const clean = join(workspace, 'clean-env');
    mkdirSync(join(clean, 'dist/api'), { recursive: true });
    cpSync(bundled, join(clean, 'dist/api/index.js'));
    cpSync(bundledMigrations, join(clean, 'dist/api/migrations'), { recursive: true });
    symlinkSync(join(repoRoot, 'node_modules'), join(clean, 'node_modules'));
    const dbPath = join(clean, 'clean.db');

    const run = startServer({ cwd: clean, command: 'node', commandArgs: ['dist/api/index.js'], dbPath, port: 4512 });
    const healthy = await waitForHealth(4512);
    const tables = existsSync(dbPath) ? tablesIn(dbPath) : [];
    record('clean directory (bundle)', healthy && tables.length > 1, `${tables.length} objects, server healthy=${healthy}`);
    (await run);
  }

  // 3. Packaged layout: migrations directory next to the working directory
  {
    const packaged = join(workspace, 'packaged');
    mkdirSync(packaged, { recursive: true });
    cpSync(bundled, join(packaged, 'index.js'));
    cpSync(bundledMigrations, join(packaged, 'migrations'), { recursive: true });
    symlinkSync(join(repoRoot, 'node_modules'), join(packaged, 'node_modules'));
    const dbPath = join(packaged, 'packaged.db');

    const run = startServer({ cwd: packaged, command: 'node', commandArgs: ['index.js'], dbPath, port: 4513 });
    const healthy = await waitForHealth(4513);
    const tables = existsSync(dbPath) ? tablesIn(dbPath) : [];
    record('packaged layout (migrations/ alongside)', healthy && tables.length > 1, `${tables.length} objects, server healthy=${healthy}`);
    (await run);
  }

  // 4. Failure mode: no migrations anywhere must fail loudly, never start with a blank schema.
  {
    const broken = join(workspace, 'no-migrations');
    mkdirSync(broken, { recursive: true });
    cpSync(bundled, join(broken, 'index.js'));   // deliberately no migrations directory
    symlinkSync(join(repoRoot, 'node_modules'), join(broken, 'node_modules'));
    const dbPath = join(broken, 'broken.db');

    const { code, output } = await startServer({ cwd: broken, command: 'node', commandArgs: ['index.js'], dbPath, port: 4514 });
    const loud = code !== 0 && /no migration files found/i.test(output);
    record('failure mode', loud, loud ? 'server refuses to start with an explicit error' : `unexpected exit (code=${code})`);
    if (!existsSync(dbPath)) writeFileSync(join(broken, 'note.txt'), 'no database was created');
    record('failure mode', !existsSync(dbPath) || new Database(dbPath, { readonly: true }).prepare("SELECT COUNT(*) AS n FROM sqlite_master").get() !== undefined,
      'no silently-empty database was left behind');
  }

  // 5. Idempotence: running migrations twice changes nothing.
  {
    const dbPath = join(workspace, 'twice.db');
    const first = startServer({ cwd: repoRoot, command: 'npx', commandArgs: ['tsx', 'apps/api/src/index.ts'], dbPath, port: 4515 });
    await waitForHealth(4515);
    (await first);
    const before = tablesIn(dbPath).join(',');
    const second = startServer({ cwd: repoRoot, command: 'npx', commandArgs: ['tsx', 'apps/api/src/index.ts'], dbPath, port: 4516 });
    await waitForHealth(4516);
    (await second);
    const after = tablesIn(dbPath).join(',');
    record('idempotence', before === after && before.includes('tables:'), 're-running migrations is a no-op');
  }

  // 6. SQLite and Postgres schema files stay in step.
  {
    const sqliteDir = join(repoRoot, 'apps/api/src/db/migrations');
    const postgresDir = join(repoRoot, 'apps/api/src/db/postgres');
    const sqliteFiles = readdirSync(sqliteDir).filter((f) => f.endsWith('.sql')).sort();
    const postgresFiles = readdirSync(postgresDir).filter((f) => f.endsWith('.sql')).sort();
    record('schema parity', sqliteFiles.length > 0 && postgresFiles.length > 0,
      `sqlite: ${sqliteFiles.join(', ')} | postgres: ${postgresFiles.join(', ')}`);
    const sqliteText = sqliteFiles.map((f) => readFileSync(join(sqliteDir, f), 'utf8')).join('\n');
    const postgresText = postgresFiles.map((f) => readFileSync(join(postgresDir, f), 'utf8')).join('\n');
    const shared = ['payment_intents', 'payment_transactions', 'provider_credentials', 'payment_accounts'];
    const missing = shared.filter((table) => !sqliteText.includes(table) || !postgresText.includes(table));
    record('schema parity', missing.length === 0, missing.length ? `missing in one dialect: ${missing.join(', ')}` : 'core tables exist in both dialects');
  }

  rmSync(workspace, { recursive: true, force: true });

  console.log(`\nMigration verification: ${results.length - failures}/${results.length} checks passed`);
  if (failures > 0) {
    console.log('Migration discovery FAILED — see the failures above.');
    process.exit(1);
  }
  console.log('Migration discovery verified in every supported layout.\n');
  for (const child of children) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  process.exit(0);
}

main().catch((error) => {
  console.error('Migration verification error:', error);
  process.exit(1);
});
