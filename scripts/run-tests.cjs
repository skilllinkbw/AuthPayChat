/**
 * Stable Windows test runner.
 *
 * WHY: better-sqlite3 is a native module. On Node >= 20/Windows, vitest worker
 * teardown can trip a V8 assertion (`RemoveEnvironmentCleanupHook`) when several
 * test files share one worker — even with `pool: forks / singleFork`. One crash
 * aborts the whole run with no useful result.
 *
 * This runner executes every test FILE in its own fresh vitest process, so:
 *   - a native-module crash in one worker can never mask the results of another
 *   - cross-file module state (e.g. REDIS_URL juggling) cannot leak between files
 *   - each file's pass/fail is reported individually and the exit code is honest
 *
 * Usage: `node scripts/run-tests.cjs [file...]`  (package.json: `npm test`)
 * Requires npm workspaces installed (npx vitest resolves locally).
 */

const { spawnSync } = require('node:child_process');
const { readdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const testsDir = join(root, 'tests');

const requested = process.argv.slice(2);
const files = (requested.length > 0 ? requested : readdirSync(testsDir).filter((f) => f.endsWith('.test.ts')))
  .map((f) => (f.endsWith('.test.ts') ? f : f + '.test.ts'));

if (!files.length) {
  console.error('No test files found.');
  process.exit(2);
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const results = [];

function parseSummary(out) {
  const summary = out.match(/Tests\s+([\d]+)\s+passed\s+\|\s+([\d]+)\s+failed\s+\|\s+([\d]+)\s+skipped/);
  if (!summary) return { pass: null, fail: null, skip: null };
  return { pass: Number(summary[1]), fail: Number(summary[2]), skip: Number(summary[3]) };
}

/** Runs one test file in its own fresh vitest process. */
function runFile(testPath) {
  const r = spawnSync(npx, ['vitest', 'run', testPath, '--reporter=json', '--outputFile=.vitest-result.json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
}

/** Parses vitest JSON output for pass/fail/skip counts. */
function parseJsonSummary() {
  try {
    const jsonPath = join(root, '.vitest-result.json');
    if (!existsSync(jsonPath)) return { pass: null, fail: null, skip: null };
    const data = JSON.parse(require('fs').readFileSync(jsonPath, 'utf8'));
    require('fs').unlinkSync(jsonPath);
    const total = data.numTotalTests ?? 0;
    const passed = data.numPassedTests ?? 0;
    const failed = data.numFailedTests ?? 0;
    const skipped = total - passed - failed;
    return { pass: passed, fail: failed, skip: Math.max(0, skipped) };
  } catch {
    return { pass: null, fail: null, skip: null };
  }
}

for (const file of files) {
  const testPath = join('tests', file);
  if (!existsSync(join(root, testPath))) {
    console.log(`✗ ${testPath} — file not found`);
    results.push({ file, ok: false, pass: 0, fail: 1, skip: 0 });
    continue;
  }
  let out = runFile(testPath);
  let summary = parseJsonSummary();
  // Ride out the flaky native teardown crash (better-sqlite3 on Node 24/Windows):
  // a worker that aborted before printing results is retried once in a fresh process.
  if (summary.pass === null || summary.pass === 0) {
    const crashed = /RemoveEnvironmentCleanupHook|ERR_IPC_CHANNEL_CLOSED|Channel closed/.test(out);
    const noResults = !out.includes('numTotalTests') && !out.includes('passed');
    if (crashed || noResults) {
      out = runFile(testPath);
      summary = parseJsonSummary();
    }
  }
  const passCount = summary.pass ?? 0;
  const failCount = summary.fail ?? 0;
  const skipCount = summary.skip ?? 0;
  const ok = failCount === 0 && passCount > 0;
  results.push({ file, ok, pass: passCount, fail: failCount, skip: skipCount });
  console.log(`${ok ? '✓' : '✗'} ${file}  (${passCount} passed, ${failCount} failed, ${skipCount} skipped)`);
  if (!ok) {
    // Surface the first meaningful failure block for diagnosis.
    const idx = out.indexOf('\n\x1b[41m') >= 0 ? out.indexOf('\n\x1b[41m') : out.indexOf(' FAIL ');
    console.log(idx >= 0 ? out.slice(0, Math.min(out.length, idx + 3000)) : out.slice(0, 2000));
  }
}

const passCount = results.filter((r) => r.ok).length;
const totalPass = results.reduce((n, r) => n + r.pass, 0);
const totalFail = results.reduce((n, r) => n + r.fail, 0);
const totalSkip = results.reduce((n, r) => n + r.skip, 0);

console.log('\n========== SUMMARY ==========');
console.log(`Test files: ${passCount} passed / ${results.length} total`);
console.log(`      Tests: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped`);
if (passCount !== results.length || totalFail > 0) {
  console.log('\nFailed files:');
  for (const r of results.filter((x) => !x.ok)) console.log(`  ✗ ${r.file}`);
  process.exit(1);
}
process.exit(0);