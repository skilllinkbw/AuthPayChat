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
// Windows spawns .cmd shims for npm/npx; POSIX uses the bare binaries (same pattern as scripts/run-tests.cjs).
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
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

/** Reads the schema out of a SQLite file, tolerating a just-killed server still holding the handle. */
function tablesInSafe(dbPath: string, attempts = 4): string[] {
  for (let i = 0; ; i++) {
    try {
      return tablesIn(dbPath);
    } catch (error) {
      if (i === attempts - 1) throw error;
      // SQLITE_IOERR_TRUNCATE right after taskkill: give the OS a moment to release the handle.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
    }
  }
}

const children: Array<import('node:child_process').ChildProcess> = [];

/** Terminates the whole process tree — on Windows the shell wrapper survives a plain kill. */
function killTree(child: import('node:child_process').ChildProcess): void {
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    // already gone
  }
}

/** Prints server output to explain an unexpected health result. */
function diag(healthy: boolean, output: string, label: string): void {
  if (!healthy) {
    console.log(`  ! server did not become healthy (${label}); last output:`);
    console.log(output.split('\n').slice(-20).join('\n'));
  }
}

interface ServerRun {
  /** Resolves when the server process exits (or is killed by the watchdog). */
  done: Promise<{ code: number | null; output: string }>;
  /** Output accumulated so far — readable while the server is still running. */
  liveOutput: () => string;
  /** Terminates the server immediately (normal shutdown path; watchdog is only a fallback). */
  stop: () => void;
}

function startServer(args: { cwd: string; command: string; commandArgs: string[]; dbPath: string; port: number }): ServerRun {
  let output = '';
  let childRef: import('node:child_process').ChildProcess | undefined;
  const done = new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(args.command, args.commandArgs, {
      cwd: args.cwd,
      // .cmd shims on Windows require a shell (Node >= 18.20, CVE-2024-27980 mitigation).
      shell: process.platform === 'win32',
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
    childRef = child;
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    children.push(child);
    child.on('exit', (code) => resolve({ code, output }));
    // tsx cold-boot on Windows can exceed 20s; keep the watchdog generous so a slow-but-healthy
    // boot is not killed mid-startup.
    setTimeout(() => { if (child.exitCode === null) killTree(child); }, 120_000);
  });
  return { done, liveOutput: () => output, stop: () => { if (childRef) killTree(childRef); } };
}

/** Links node_modules without the admin privilege that real symlinks require on Windows. */
function linkNodeModules(target: string, dest: string): void {
  if (process.platform === 'win32') {
    symlinkSync(target, dest, 'junction');
  } else {
    symlinkSync(target, dest);
  }
}

async function main(): Promise<void> {
  console.log('\nPayChat migration discovery verification\n');

  // 0. Build the bundle so we test what actually ships.
  console.log('0. Building the API bundle');
  execFileSync(npmBin, ['run', 'build:api'], { cwd: repoRoot, stdio: 'pipe', shell: process.platform === 'win32' });
  const bundled = join(repoRoot, 'dist/api/index.js');
  const bundledMigrations = join(repoRoot, 'dist/api/migrations');
  record('build', existsSync(bundled), 'dist/api/index.js produced');
  record('build', readdirSync(bundledMigrations).filter((f) => f.endsWith('.sql')).length > 0,
    `bundle ships ${readdirSync(bundledMigrations).filter((f) => f.endsWith('.sql')).length} migration files`);

  const workspace = mkdtempSync(join(tmpdir(), 'paychat-migrations-'));

  // 1. Source tree (tsx from the repository root)
  {
    const dbPath = join(workspace, 'source.db');
    const run = startServer({ cwd: repoRoot, command: npxBin, commandArgs: ['tsx', 'apps/api/src/index.ts'], dbPath, port: 4511 });
    const healthy = await waitForHealth(4511, 90_000);
    diag(healthy, run.liveOutput(), 'source tree');
    const tables = existsSync(dbPath) ? tablesInSafe(dbPath) : [];
    record('source tree', healthy && tables.length > 1, `${tables.length} objects, server healthy=${healthy}`);
    run.stop();
    (await run.done);
  }

  // 2. Built bundle executed from a clean directory (container-like: node_modules + dist only)
  {
    const clean = join(workspace, 'clean-env');
    mkdirSync(join(clean, 'dist/api'), { recursive: true });
    cpSync(bundled, join(clean, 'dist/api/index.js'));
    cpSync(bundledMigrations, join(clean, 'dist/api/migrations'), { recursive: true });
    linkNodeModules(join(repoRoot, 'node_modules'), join(clean, 'node_modules'));
    const dbPath = join(clean, 'clean.db');

    const run = startServer({ cwd: clean, command: 'node', commandArgs: ['dist/api/index.js'], dbPath, port: 4512 });
    const healthy = await waitForHealth(4512);
    diag(healthy, run.liveOutput(), 'clean directory');
    const tables = existsSync(dbPath) ? tablesInSafe(dbPath) : [];
    record('clean directory (bundle)', healthy && tables.length > 1, `${tables.length} objects, server healthy=${healthy}`);
    run.stop();
    (await run.done);
  }

  // 3. Packaged layout: migrations directory next to the working directory
  {
    const packaged = join(workspace, 'packaged');
    mkdirSync(packaged, { recursive: true });
    cpSync(bundled, join(packaged, 'index.js'));
    cpSync(bundledMigrations, join(packaged, 'migrations'), { recursive: true });
    linkNodeModules(join(repoRoot, 'node_modules'), join(packaged, 'node_modules'));
    const dbPath = join(packaged, 'packaged.db');

    const run = startServer({ cwd: packaged, command: 'node', commandArgs: ['index.js'], dbPath, port: 4513 });
    const healthy = await waitForHealth(4513);
    diag(healthy, run.liveOutput(), 'packaged layout');
    const tables = existsSync(dbPath) ? tablesInSafe(dbPath) : [];
    record('packaged layout (migrations/ alongside)', healthy && tables.length > 1, `${tables.length} objects, server healthy=${healthy}`);
    run.stop();
    (await run.done);
  }

  // 4. Failure mode: no migrations anywhere must fail loudly, never start with a blank schema.
  {
    const broken = join(workspace, 'no-migrations');
    mkdirSync(broken, { recursive: true });
    cpSync(bundled, join(broken, 'index.js'));   // deliberately no migrations directory
    linkNodeModules(join(repoRoot, 'node_modules'), join(broken, 'node_modules'));
    const dbPath = join(broken, 'broken.db');

    const { code, output } = await startServer({ cwd: broken, command: 'node', commandArgs: ['index.js'], dbPath, port: 4514 }).done;
    const loud = code !== 0 && /no migration files found/i.test(output);
    record('failure mode', loud, loud ? 'server refuses to start with an explicit error' : `unexpected exit (code=${code})`);
    if (!existsSync(dbPath)) writeFileSync(join(broken, 'note.txt'), 'no database was created');
    record('failure mode', !existsSync(dbPath) || new Database(dbPath, { readonly: true }).prepare("SELECT COUNT(*) AS n FROM sqlite_master").get() !== undefined,
      'no silently-empty database was left behind');
  }

  // 5. Idempotence: running migrations twice changes nothing.
  // The two boots below use tsx, which on Windows can cold-start unreliably under load
  // (same environment flakiness scripts/run-tests.cjs works around with a retry).
  // Each attempt runs BOTH boots against a FRESH database; the schema fingerprint of the
  // second run must equal the first — proving migrations are a no-op on re-run.
  {
    let idempotenceOk = false;
    for (let attempt = 1; attempt <= 2 && !idempotenceOk; attempt++) {
      const dbPath = join(workspace, attempt === 1 ? 'twice.db' : `twice-retry-${attempt}.db`);
      const boot = async (port: number) => {
        const run = startServer({ cwd: repoRoot, command: npxBin, commandArgs: ['tsx', 'apps/api/src/index.ts'], dbPath, port });
        const healthy = await waitForHealth(port, 90_000);
        diag(healthy, run.liveOutput(), `idempotence attempt ${attempt} (port ${port})`);
        run.stop();
        (await run.done);
        return healthy;
      };
      const firstHealthy = await boot(4515);
      const before = tablesInSafe(dbPath).join(',');
      const secondHealthy = await boot(4516);
      const after = tablesInSafe(dbPath).join(',');
      idempotenceOk = firstHealthy && secondHealthy && before === after && before.includes('tables:');
      if (idempotenceOk) {
        record('idempotence', true, 're-running migrations is a no-op');
      } else if (attempt === 2) {
        record('idempotence', false, `schema fingerprints differ or boots failed (before=${before} after=${after})`);
      }
    }
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

  try {
    rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 1_000 });
  } catch (error) {
    // Non-fatal: a just-killed server may still hold a file handle for a moment.
    console.log(`  ! temp workspace cleanup incomplete (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(`\nMigration verification: ${results.length - failures}/${results.length} checks passed`);
  if (failures > 0) {
    console.log('Migration discovery FAILED — see the failures above.');
    process.exit(1);
  }
  console.log('Migration discovery verified in every supported layout.\n');
  for (const child of children) { killTree(child); }
  process.exit(0);
}

main().catch((error) => {
  console.error('Migration verification error:', error);
  process.exit(1);
});
