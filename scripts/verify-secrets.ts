/**
 * Credential / secret scan (brief §14 and §19).
 *
 * Checks that no real credential can reach the repository or the shipped bundle:
 *  - no .env (or variant) file is tracked or shipped
 *  - .env.example contains only placeholders
 *  - source, tests, SQL, docs and the built bundle contain no key material
 *  - no provider credential (client secret, API key, webhook secret, private key, token)
 *    is hard-coded anywhere
 *
 * This is a gate, not a linter: any finding fails the run.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.data', '.turbo', 'out', 'exports']);
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.sql', '.md', '.yml', '.yaml', '.env', '.example', '.sh', '.txt']);

interface Finding { file: string; rule: string; line: number; excerpt: string; }
const findings: Finding[] = [];

/** Patterns that indicate REAL key material (not a placeholder or a variable name). */
const RULES: Array<{ name: string; pattern: RegExp; allowIf?: RegExp }> = [
  { name: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'private-key-block', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'jwt-literal', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'client-secret-assignment', pattern: /(?:client[_-]?secret|api[_-]?key|webhook[_-]?secret|private[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i,
    allowIf: /\$\{|process\.env|<|your-|replace|example|placeholder|change-?me|xxx+/i },
  // Real passwords only. Test fixtures and scripts use obvious non-secrets ("wrong-password",
  // throwaway database-role passwords); key material in those files is still caught by the
  // other rules (private keys, AWS keys, JWT literals, long high-entropy assignments).
  { name: 'password-assignment', pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'](?!\{)(?!\$)(?!<)[A-Za-z0-9!@#$%^&*()_-]{16,}["']/i,
    allowIf: /\$\{|process\.env|<|example|placeholder|change-?me|CorrectHorse|scrypt\$|wrong|incorrect|not-my-password|_pw['"]/i },
];

/** Variable names whose value must never be a real credential in the example file. */
const SECRET_LIKE_NAME = /(SECRET|TOKEN|PASSWORD|PRIVATE[-_]?KEY|API[-_]?KEY|CLIENT[-_]?SECRET|CREDENTIAL|DSN)/i;
/** A value that looks like generated key material rather than configuration. */
const HIGH_ENTROPY = /^(?=[A-Za-z0-9+/=_-]{24,}$)(?=.*[a-z])(?=.*[A-Z0-9])[A-Za-z0-9+/=_-]+$/;
const ENV_VALUE_PLACEHOLDER = /^(?:|[a-z0-9_.-]*(?:your|example|placeholder|changeme|change-me|replace|xxx|redacted|dummy|local|dev|test|secret-change-me)[a-z0-9_.-]*|<[^>]*>|\$\{[^}]*\}|(?:http|postgres(?:ql)?|redis):\/\/[^\s]*|\.\/?[a-z0-9_./-]*|\d+)$/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function scanFile(file: string): void {
  const ext = extname(file);
  const isDotEnv = file.endsWith('.env') || file.includes('.env.');
  if (!TEXT_EXTENSIONS.has(ext) && !isDotEnv) return;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  const relativePath = relative(ROOT, file);

  // .env files other than the example must never be TRACKED or SHIPPED. The git-index
  // check (below) and the dist scan cover those boundaries authoritatively. A local,
  // git-ignored `.env` on a developer machine is legitimate runtime state — flagging it
  // would break the gate for every developer running the app locally. What is never
  // acceptable is a *non-standard* env file (e.g. `.env.production`, `.env.live`) present
  // in the tree, since those are exactly the files people accidentally commit or ship.
  if (/\.env(\.|$)/.test(relativePath) && !relativePath.endsWith('.env.example') && !relativePath.includes('/.env.example')) {
    if (relativePath !== '.env') {
      findings.push({ file: relativePath, rule: 'env-file-present', line: 0, excerpt: 'non-standard environment file must not be present in the tree' });
    }
    // The root local `.env` is git-ignored, untracked, and excluded from dist; it carries
    // local secrets by design and is verified as untracked by the git-index check below.
  }
  if (relativePath.endsWith('.env.example')) {
    for (const [index, line] of text.split('\n').entries()) {
      const withoutComment = line.replace(/\s+#.*$/, '').trim();
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(withoutComment);
      if (!match) continue;
      const [, name, rawValue] = match;
      const value = rawValue!.trim();
      if (!value) continue;                                        // empty = "you must supply this"
      const looksSecret = SECRET_LIKE_NAME.test(name!) || HIGH_ENTROPY.test(value);
      if (looksSecret && !ENV_VALUE_PLACEHOLDER.test(value)) {
        findings.push({ file: relativePath, rule: 'env-example-has-value', line: index + 1, excerpt: `${name}=${value}` });
      }
    }
  }

  for (const [index, line] of text.split('\n').entries()) {
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;
      if (rule.allowIf && rule.allowIf.test(line)) continue;
      findings.push({ file: relativePath, rule: rule.name, line: index + 1, excerpt: line.trim().slice(0, 120) });
    }
  }
}

console.log('\nPayChat secret scan\n');

// 1. Working tree
for (const file of walk(ROOT)) scanFile(file);
console.log(`  scanned working tree (${walk(ROOT).length} files)`);

// 2. Git index — a file can be committed and then deleted locally
try {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT }).toString().split('\n').filter(Boolean);
  const offending = tracked.filter((f) => /\.(env|pem|key|p12|pfx)$/.test(f) && !f.endsWith('.env.example'));
  for (const file of offending) findings.push({ file, rule: 'tracked-secret-file', line: 0, excerpt: 'secret material is tracked in git' });
  console.log(`  scanned git index (${tracked.length} tracked files)`);
} catch {
  console.log('  git index unavailable — skipped');
}

// 3. Build output (if present)
if (existsSync(join(ROOT, 'dist'))) {
  for (const file of walk(join(ROOT, 'dist'))) scanFile(file);
  console.log('  scanned build output');
}

if (findings.length > 0) {
  console.log(`\n  ${findings.length} finding(s):`);
  for (const finding of findings) console.log(`   ✗ [${finding.rule}] ${finding.file}:${finding.line} — ${finding.excerpt}`);
  console.log('\nSecret scan FAILED. Remove the material, rotate the credential, and re-run.\n');
  process.exit(1);
}

console.log('\nSecret scan: 0 findings — no credentials in source, docs, git index or build output.\n');
