import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readVapid } from '../server/push/webPush.js';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'vapid-keys.mjs');

function run(args = []) {
  const cwd = mkdtempSync(join(tmpdir(), 'vapid-'));
  const out = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  const files = readdirSync(cwd);
  rmSync(cwd, { recursive: true, force: true });
  return { ...out, files };
}

test('prints the three .env lines, a pair JagHelm accepts, and writes no file', () => {
  const out = run(['mailto:ops@example.net']);
  assert.equal(out.status, 0);
  assert.deepEqual(out.files, []);
  const env = Object.fromEntries(out.stdout.trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
  assert.deepEqual(Object.keys(env), ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']);
  assert.equal(readVapid(env).enabled, true);
  assert.ok(!out.stderr.includes(env.VAPID_PRIVATE_KEY), 'the key is on stdout only');
});

test('prints a different pair each time, and leaves the subject for you without an argument', () => {
  const a = run();
  const b = run();
  assert.notEqual(a.stdout, b.stdout);
  assert.match(a.stdout, /VAPID_SUBJECT=\n?$/);
  assert.match(a.stderr, /Fill in VAPID_SUBJECT/);
});

test('refuses a subject that is neither mailto: nor https:', () => {
  const out = run(['http://insecure.example']);
  assert.equal(out.status, 2);
  assert.equal(out.stdout, '');
});
