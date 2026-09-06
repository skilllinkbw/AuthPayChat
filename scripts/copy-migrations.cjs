/**
 * Cross-platform migration publishing for build:api.
 * Replaces POSIX-only `mkdir -p` / `cp` so `npm run build` works identically on
 * Windows cmd, PowerShell and any Unix shell.
 */
const { mkdirSync, copyFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const migrationsSrc = join(root, 'apps', 'api', 'src', 'db', 'migrations');
const migrationsDist = join(root, 'dist', 'api', 'migrations');

mkdirSync(migrationsDist, { recursive: true });
const copied = [];
for (const entry of readdirSync(migrationsSrc).filter((f) => f.endsWith('.sql'))) {
  copyFileSync(join(migrationsSrc, entry), join(migrationsDist, entry));
  copied.push(entry);
}
console.log(`published ${copied.length} migration(s) -> dist/api/migrations`, copied.join(', '));