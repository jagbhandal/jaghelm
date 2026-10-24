// scripts/ci-audit.sh (#616): tells an advisory from a registry error from a timeout.
// A FAKE audit command prints a fixture, so no network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'ci-audit.sh');

function run(shellBody, env = {}) {
  const r = spawnSync('bash', [SCRIPT, 'bash', '-c', shellBody], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { status: r.status, out: r.stdout + r.stderr };
}

test('an advisory report is ADVISORY even when its text has network words', () => {
  const report = [
    '# npm audit report', '', 'evil  <=1.0.0', 'Severity: high',
    'Denial of service over the network - https://github.com/advisories/GHSA-x',
    'ECONNRESET handling flaw in evil - https://github.com/advisories/GHSA-y',
    'fetch failed to validate input; E503 E429 self-signed', 'node_modules/evil', '',
    '1 high severity vulnerability',
  ].join('\n');
  const r = run(`printf '${report}\n'; exit 1`);
  assert.equal(r.status, 1);
  assert.match(r.out, /::error::ADVISORY/);
  assert.doesNotMatch(r.out, /AUDIT NOT RUN/);
});

test('a bare summary line alone is ADVISORY', () => {
  const r = run(`echo '3 critical severity vulnerabilities'; exit 1`);
  assert.match(r.out, /::error::ADVISORY/);
});

test('a registry error is AUDIT NOT RUN', () => {
  const r = run(`echo 'npm warn audit request to https://registry.npmjs.org/x failed, reason: connect ECONNREFUSED 1.2.3.4:443'; echo 'npm error audit endpoint returned an error'; exit 1`);
  assert.equal(r.status, 1);
  assert.match(r.out, /::error::AUDIT NOT RUN.*could not reach the npm registry/);
});

test('a timeout says so', () => {
  const r = run('sleep 3', { AUDIT_TIMEOUT: '1' });
  assert.equal(r.status, 1);
  assert.match(r.out, /timed out after 1s/);
});

test('a clean audit exits 0', () => {
  const r = run(`echo 'found 0 vulnerabilities'`);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.out, /::error::/);
});

test('an unknown failure is AUDIT FAILED', () => {
  const r = run(`echo 'something odd about the network'; exit 7`);
  assert.equal(r.status, 1);
  assert.match(r.out, /::error::AUDIT FAILED with exit code 7/);
});
