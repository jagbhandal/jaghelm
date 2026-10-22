/**
 * Secrets manager — AES-256-GCM round-trip, tamper detection, salt, precedence.
 * Runs against an isolated temp data dir (JAGHELM_DATA_DIR) so it never touches
 * a real secrets store. node --test isolates each file in its own process, so
 * the env vars set here don't leak into other suites.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'jaghelm-secrets-'));
process.env.JAGHELM_DATA_DIR = dir;
process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

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

// ── #502: a change that has to be undone ──

test('restoreSecrets puts the store back as snapshotSecrets found it, secrets.json byte-for-byte', () => {
  const path = join(dir, 'secrets.json');
  // Formatted by hand, so a rewrite of the file would show.
  writeFileSync(path, JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))));
  secrets.initSecrets();
  const before = { file: readFileSync(path, 'utf8'), names: secrets.listSecretKeys() };

  const snapshot = secrets.snapshotSecrets();
  secrets.setSecret('api_key', 'replaced');
  secrets.setSecret('added', 'new');
  secrets.deleteSecret('mykey');
  secrets.copySecret('added', 'copied');
  secrets.restoreSecrets(snapshot);

  assert.equal(readFileSync(path, 'utf8'), before.file);
  assert.deepEqual(secrets.listSecretKeys(), before.names, 'the same names, in the same order');
  assert.equal(secrets.getSecret('api_key'), 'super-sensitive');
  assert.equal(secrets.getSecret('mykey'), 'from-store');
  assert.equal(secrets.hasSecret('added'), false);
  assert.equal(secrets.hasSecret('copied'), false);

  // The next change starts from the restored store.
  secrets.setSecret('later', 'x');
  assert.deepEqual(secrets.listSecretKeys(), [...before.names, 'later']);
  secrets.deleteSecret('later');
});

test('restoring a store that had no secrets.json removes the one written since', () => {
  const path = join(dir, 'secrets.json');
  const kept = readFileSync(path);
  rmSync(path);
  const snapshot = secrets.snapshotSecrets();
  secrets.setSecret('added', 'new');
  assert.ok(existsSync(path));
  secrets.restoreSecrets(snapshot);
  assert.equal(existsSync(path), false);
  assert.equal(secrets.hasSecret('added'), false);
  writeFileSync(path, kept);
  secrets.initSecrets();
});

/** Run `fn` with every write of secrets.json failing as a full disk does; count them. */
function withFullDisk(fn) {
  const path = join(dir, 'secrets.json');
  const rename = fs.renameSync;
  const attempts = { writes: 0 };
  fs.renameSync = (from, to) => {
    if (to !== path) return rename(from, to);
    attempts.writes++;
    throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
  };
  syncBuiltinESMExports();
  try {
    fn(attempts);
  } finally {
    fs.renameSync = rename;
    syncBuiltinESMExports();
  }
}

test('a change secrets.json cannot take throws, and the store in memory stays as it was', () => {
  const path = join(dir, 'secrets.json');
  secrets.setSecret('kept', 'k');
  const before = { file: readFileSync(path, 'utf8'), names: secrets.listSecretKeys() };
  withFullDisk(() => {
    assert.throws(() => secrets.setSecret('api_key', 'replaced'), { code: 'ENOSPC' });
    assert.throws(() => secrets.setSecret('added', 'new'), { code: 'ENOSPC' });
    assert.throws(() => secrets.copySecret('api_key', 'copied'), { code: 'ENOSPC' });
    assert.throws(() => secrets.deleteSecret('kept'), { code: 'ENOSPC' });
    assert.throws(() => secrets.deleteSecrets(['kept', 'mykey']), { code: 'ENOSPC' });
  });
  assert.equal(secrets.getSecret('api_key'), 'super-sensitive');
  assert.equal(secrets.getSecret('kept'), 'k');
  assert.equal(secrets.getSecret('mykey'), 'from-store');
  assert.equal(secrets.hasSecret('added'), false);
  assert.equal(secrets.hasSecret('copied'), false);
  assert.deepEqual(secrets.listSecretKeys(), before.names, 'in the same order');
  assert.equal(readFileSync(path, 'utf8'), before.file);
  secrets.deleteSecret('kept');
});

test('a change whose own write failed (a full disk) is undone without writing secrets.json', () => {
  const path = join(dir, 'secrets.json');
  const before = readFileSync(path, 'utf8');
  withFullDisk((attempts) => {
    const snapshot = secrets.snapshotSecrets();
    assert.throws(() => secrets.setSecret('api_key', 'replaced'));
    assert.equal(attempts.writes, 1);
    secrets.restoreSecrets(snapshot);
    assert.equal(attempts.writes, 1, 'nothing to write back');
  });
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(secrets.getSecret('api_key'), 'super-sensitive');
});

test('deleteSecrets removes the names it is given that are stored, and says how many', () => {
  secrets.setSecret('one', '1');
  secrets.setSecret('two', '2');
  assert.equal(secrets.deleteSecrets(['one', 'two', 'never_stored']), 2);
  assert.equal(secrets.hasSecret('one'), false);
  assert.equal(secrets.hasSecret('two'), false);
  assert.ok(!readFileSync(join(dir, 'secrets.json'), 'utf8').includes('"one"'));
  assert.equal(secrets.deleteSecrets([]), 0);
});
