/**
 * Secrets manager — AES-256-GCM round-trip, tamper detection, salt, precedence.
 * Runs against an isolated temp data dir (JAGHELM_DATA_DIR) so it never touches
 * a real secrets store. node --test isolates each file in its own process, so
 * the env vars set here don't leak into other suites.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'jaghelm-secrets-'));
process.env.JAGHELM_DATA_DIR = dir;
process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long';

const secrets = await import('./secrets.js');

after(() => rmSync(dir, { recursive: true, force: true }));

test('encrypts and decrypts a value (AES-256-GCM round-trip)', () => {
  assert.equal(secrets.setSecret('api_key', 'super-sensitive'), true);
  assert.equal(secrets.getSecret('api_key'), 'super-sensitive');
});

test('generates a per-install random salt (not the legacy static one)', () => {
  assert.ok(existsSync(join(dir, '.secrets-salt')), 'salt file should exist');
  const salt = readFileSync(join(dir, '.secrets-salt'), 'utf8').trim();
  assert.match(salt, /^[0-9a-f]{32}$/, 'salt should be 16 random bytes hex');
  assert.notEqual(salt, 'jaghelm-secrets-v1');
});

test('tampered ciphertext fails closed to null (auth tag rejects it)', () => {
  secrets.setSecret('tok', 'value');
  const path = join(dir, 'secrets.json');
  const store = JSON.parse(readFileSync(path, 'utf8'));
  // Flip the first hex nibble of the ciphertext.
  store.tok.data = (store.tok.data[0] === 'a' ? 'b' : 'a') + store.tok.data.slice(1);
  writeFileSync(path, JSON.stringify(store));
  secrets.initSecrets(); // reload tampered store from disk
  assert.equal(secrets.getSecret('tok'), null);
});

test('resolveCredential prefers env over the stored secret', () => {
  secrets.setSecret('mykey', 'from-store');
  process.env.MY_ENV_CRED = 'from-env';
  assert.equal(secrets.resolveCredential('MY_ENV_CRED', 'mykey'), 'from-env');
  delete process.env.MY_ENV_CRED;
  assert.equal(secrets.resolveCredential('MY_ENV_CRED', 'mykey'), 'from-store');
});

test('listSecretKeys returns names only and never the salt', () => {
  const keys = secrets.listSecretKeys();
  assert.ok(Array.isArray(keys));
  assert.ok(!keys.includes('.secrets-salt'));
});
