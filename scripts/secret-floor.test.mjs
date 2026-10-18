// Phase 0 secret floor: .gitignore keeps real secrets out and templates in, the
// templates stay tracked, and scripts/secret-scan.py catches a planted key. Plain
// node:test so `npm test` runs it in both CI systems (#212: the shell versions these
// replace only ran locally). Needs git + python3, which both CI images provide.
//
// No real secret is ever committed: the fake keys below are written to a temp dir
// OUTSIDE the worktree and removed afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCANNER = 'scripts/secret-scan.py';
// Committed secret templates: tracked, never ignored, and clean to the scanner.
const TEMPLATES = ['env.example', 'fcm-service-account.json.example'];

// Real secret files .gitignore must keep out.
const SECRETS = ['test.pem', 'test.jks', 'google-services.json', 'acme-service-account.json', 'keystore.properties'];

function gitIn(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.error) throw r.error; // git missing: fail as that, not as "not ignored"
  return r;
}
const git = (...args) => gitIn(ROOT, ...args);

/** Run the scanner on one file; returns its exit status (throws if python3 is missing). */
function scan(file) {
  const r = spawnSync('python3', [SCANNER, file], { cwd: ROOT, encoding: 'utf8' });
  if (r.error) throw r.error;
  return r.status;
}

/** The secret files in SECRETS that the repo at `cwd` does not ignore. Plain
 *  check-ignore (no --no-index): it reports a tracked path as not ignored, so a
 *  secret force-added past the rules (`git add -f`) is caught too. */
function secretsNotIgnored(cwd) {
  return SECRETS.filter((f) => gitIn(cwd, 'check-ignore', '-q', f).status !== 0);
}

test('.gitignore ignores real secret files', () => {
  const missed = secretsNotIgnored(ROOT);
  assert.deepEqual(missed, [], `secret file(s) NOT ignored: ${missed.join(', ')}`);
});

test('a secret force-added past .gitignore (git add -f) counts as not ignored', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jaghelm-force-tracked-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  gitIn(dir, 'init', '-q');
  copyFileSync(path.join(ROOT, '.gitignore'), path.join(dir, '.gitignore'));
  writeFileSync(path.join(dir, 'google-services.json'), '{}\n');
  assert.deepEqual(secretsNotIgnored(dir), [], 'fixture: the repo rules ignore every secret');
  gitIn(dir, 'add', '-f', 'google-services.json');
  assert.deepEqual(secretsNotIgnored(dir), ['google-services.json']);
});

// Templates are tracked, so here --no-index is needed to test the ignore RULES: plain
// check-ignore reports a tracked path as not ignored, which would hide a glob
// swallowing a template.

test('.gitignore does not ignore the secret templates (negations win)', () => {
  for (const f of [...TEMPLATES, '.env.example']) {
    assert.equal(git('check-ignore', '-q', '--no-index', f).status, 1, `template ${f} IS ignored`);
  }
});

test('secret templates exist, are tracked, and the scanner passes the FCM template', () => {
  for (const f of TEMPLATES) {
    assert.ok(existsSync(path.join(ROOT, f)), `${f} missing on disk`);
    assert.equal(git('ls-files', '--error-unmatch', '--', f).status, 0, `${f} is not git-tracked`);
  }
  assert.equal(scan('fcm-service-account.json.example'), 0, 'scanner flagged the .example template');
});

test('secret-scan.py is present and executable', () => {
  const p = path.join(ROOT, SCANNER);
  assert.ok(existsSync(p), `${SCANNER} missing`);
  assert.ok(statSync(p).mode & 0o111, `${SCANNER} not executable`);
});

test('secret-scan.py flags a planted GCP service-account key and a bare PEM', (t) => {
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvFAKEFAKEFAKE\n-----END PRIVATE KEY-----\n'; // pragma: allowlist secret
  const dir = mkdtempSync(path.join(tmpdir(), 'jaghelm-planted-key-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const planted = {
    // as a downloaded SA key file stores it: PEM newlines escaped inside the JSON string
    'sa.json': JSON.stringify({ type: 'service_account', private_key: pem }, null, 1),
    // the same key pasted with raw newlines inside the string
    'sa-raw.json': `{\n "type":"service_account",\n "private_key":"${pem}"\n}\n`,
    // a bare PKCS#8 PEM file
    'key.pem': pem,
  };
  for (const [name, body] of Object.entries(planted)) {
    const file = path.join(dir, name);
    writeFileSync(file, body);
    // exactly 1 = findings; 0 = missed, 2 = bad input (would otherwise pass as "not clean")
    assert.equal(scan(file), 1, `${name}: planted key not caught`);
  }
  // belt-and-braces: the temp dir is outside the repo, so git must see none of it
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  assert.doesNotMatch(status, /sa(-raw)?\.json|key\.pem/, 'planted key file visible in git status');
});
