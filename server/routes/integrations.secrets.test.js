/**
 * #415, #502: an integration's stored secrets live and die with its entry.
 *
 * Deleting an integration removed its services.yaml entry and left its keyed
 * secrets (integration_<key>_*) in the store, where a new integration under
 * the same key picked them up (#415). A save stored the typed secrets and then
 * wrote services.yaml; when that write failed or was refused, the secrets
 * stayed, with nothing referring to them (#502). Now a save whose write fails
 * leaves secrets.json byte-for-byte as it was, and a delete removes the
 * secrets under its key that no remaining entry uses.
 *
 * These drive the real route against the real config and secrets modules. A
 * failed write is the rename that puts a file in place (atomicWriteFileSync)
 * failing, swapped in through fs and syncBuiltinESMExports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import yaml from 'js-yaml';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const { loadConfig, getConfig } = await import('../config.js');
const { initSecrets, setSecret, getSecret, hasSecret, deleteSecret, listSecretKeys } =
  await import('../secrets.js');
const { initRegistry } = await import('../integrations/registry.js');
const { resolveIntegrationConfig } = await import('../integrations/lib/config.js');
const { integrationRoutes } = await import('./integrations.js');

initSecrets();
await initRegistry();

const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');
const SECRETS_PATH = join(process.env.JAGHELM_DATA_DIR, 'secrets.json');

const app = express();
app.use(express.json());
app.use('/api/integrations', integrationRoutes);
const save = (body) => request(app).post('/api/integrations/save').send(body);
const remove = (key) => request(app).delete(`/api/integrations/${key}`);

const fileText = () => readFileSync(CONFIG_PATH, 'utf8');
const secretsText = () => (existsSync(SECRETS_PATH) ? readFileSync(SECRETS_PATH, 'utf8') : '');
const stored = () => yaml.load(fileText()).integrations;
/** Both files as they are now, and the names in the store, in order. */
const snapshot = () => ({ file: fileText(), secrets: secretsText(), names: listSecretKeys() });
/** Put `text` on disk and load it, as the config watcher does after a hand edit. */
function handEdit(text) {
  writeFileSync(CONFIG_PATH, text);
  loadConfig();
}
/** What the refresh loop resolves the entry under `key` to (credentials included). */
function resolved(key) {
  const cfg = getConfig().integrations[key];
  return resolveIntegrationConfig(cfg.preset || key, { ...cfg, _storageKey: key });
}

/**
 * Run `fn` with every rename onto `target` replaced by `instead(from, to,
 * rename)`; other renames are real. It is put back afterwards.
 */
async function withRenameOnto(target, instead, fn) {
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => (to === target ? instead(from, to, rename) : rename(from, to));
  syncBuiltinESMExports();
  try {
    return await fn();
  } finally {
    fs.renameSync = rename;
    syncBuiltinESMExports();
  }
}

/** A write that fails as a full disk does. */
const diskFull = () => {
  throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
};

// One indentation slip on line 3.
const BROKEN = ['integrations:', '  npm:', '   url: http://npm.example.test', '    preset: npm', ''].join('\n');

const NPM_URL = 'http://npm.example.test';
const NPM = {
  preset: 'npm',
  url: NPM_URL,
  username: 'admin',
  password: '$secret:integration_npm_password', // pragma: allowlist secret
};
const NPM_TWO = {
  preset: 'npm',
  instance: 'two',
  url: 'http://npm-two.example.test',
  username: 'admin',
  password: '$secret:integration_npm_two_password', // pragma: allowlist secret
};

/**
 * Two NPMs, whose keys share a prefix, with their stored credentials, and a
 * secret of the user's own, written by hand, in an otherwise empty store.
 */
function twoNpms(extra = {}) {
  for (const name of listSecretKeys()) deleteSecret(name);
  setSecret('integration_npm_password', 'pw-npm');
  setSecret('integration_npm_url', 'http://keyed-npm.example.test');
  setSecret('integration_npm_token', 'tok-npm');
  setSecret('integration_npm_two_password', 'pw-two');
  setSecret('my_own_token', 'mine');
  handEdit(
    [
      '# Written by hand, so any rewrite of the file shows.',
      yaml.dump({ integrations: { npm: NPM, npm_two: NPM_TWO, ...extra } }),
    ].join('\n')
  );
}

// ── #415: a delete takes the entry's secrets with it ──

test("deleting an integration removes the secrets stored under its key, and no other integration's or the user's own", async () => {
  twoNpms();
  assert.equal(resolved('npm')._password, 'pw-npm');

  const r = await remove('npm');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(stored(), { npm_two: NPM_TWO });

  assert.deepEqual(
    listSecretKeys().filter((name) => name.startsWith('integration_npm_')),
    ['integration_npm_two_password'],
    'no integration_npm_* secret remains but the other NPM’s'
  );
  assert.equal(resolved('npm_two')._password, 'pw-two');
  assert.equal(getSecret('my_own_token'), 'mine');
  assert.ok(!secretsText().includes('"integration_npm_password"'), 'gone from secrets.json too');
});

test('a new integration under a deleted key starts with no credential', async () => {
  twoNpms();
  assert.equal((await remove('npm')).status, 200);

  const r = await save({
    type: 'npm',
    url: 'http://new-npm.example.test',
    enabled: true,
    target: '',
    username: 'admin',
    create: true,
  });
  assert.deepEqual(r.body, { ok: true, type: 'npm' });
  assert.equal(stored().npm.password, undefined);
  const npm = resolved('npm');
  assert.equal(npm._password ?? null, null, 'the deleted entry’s password is not picked up');
  assert.equal(npm.url, 'http://new-npm.example.test', 'nor its stored URL');
});

test('a secret another entry still names is kept when the entry is deleted', async () => {
  // Written by hand: a second NPM that uses the first one's password.
  twoNpms({
    npm_backup: { ...NPM_TWO, instance: 'backup', password: '$secret:integration_npm_password' }, // pragma: allowlist secret
  });
  assert.equal((await remove('npm')).status, 200);
  assert.equal(resolved('npm_backup')._password, 'pw-npm');
  assert.equal(hasSecret('integration_npm_url'), false);
  assert.equal(hasSecret('integration_npm_token'), false);
});

test("a delete that can't write services.yaml keeps the integration and secrets.json byte-for-byte", async () => {
  twoNpms();
  const before = snapshot();
  const r = await withRenameOnto(CONFIG_PATH, diskFull, () => remove('npm'));
  assert.equal(r.status, 500);
  assert.deepEqual(snapshot(), before);
  assert.equal(resolved('npm')._password, 'pw-npm');
});

// ── #502: a save whose services.yaml write fails stores nothing ──

/** Saves that store or move a secret before services.yaml is written. */
const SAVES = {
  'an edit with a new password': {
    type: 'npm',
    url: 'http://moved-npm.example.test',
    target: '',
    username: 'admin',
    password: 'pw-typed', // pragma: allowlist secret
    editingKey: 'npm',
  },
  'a new integration with a password and a token': {
    type: 'npm',
    instance: 'three',
    url: 'http://npm-three.example.test',
    enabled: true,
    target: '',
    username: 'admin',
    password: 'pw-three', // pragma: allowlist secret
    token: 'tok-three', // pragma: allowlist secret
    create: true,
  },
  'a rename, which moves the credentials to the new key': {
    type: 'npm',
    instance: 'four',
    url: NPM_TWO.url,
    target: '',
    username: 'admin',
    editingKey: 'npm_two',
  },
};

/** The credentials as they were, and nothing under the keys the saves write. */
function assertStoreAsBefore(before) {
  assert.deepEqual(snapshot(), before);
  assert.equal(resolved('npm')._password, 'pw-npm');
  assert.equal(resolved('npm').url, 'http://keyed-npm.example.test');
  assert.equal(resolved('npm_two')._password, 'pw-two');
  for (const key of ['npm_three', 'npm_four']) {
    for (const field of ['url', 'username', 'password', 'token']) {
      assert.equal(hasSecret(`integration_${key}_${field}`), false, `integration_${key}_${field}`);
    }
  }
}

for (const [what, body] of Object.entries(SAVES)) {
  test(`${what}: a services.yaml write that throws leaves secrets.json byte-for-byte as before`, async () => {
    twoNpms();
    const before = snapshot();
    const r = await withRenameOnto(CONFIG_PATH, diskFull, () => save(body));
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: 'Failed to persist config' });
    assertStoreAsBefore(before);

    // The same save once the disk has room again is saved as before.
    const ok = await save(body);
    assert.equal(ok.status, 200);
  });
}

test('a hand edit that breaks services.yaml during a save: the write is refused, and secrets.json is byte-for-byte as before', async () => {
  for (const body of Object.values(SAVES)) {
    twoNpms();
    const before = snapshot();
    // The edit lands as the save stores its first secret, between its read
    // of services.yaml and its write.
    let edited = false;
    const r = await withRenameOnto(
      SECRETS_PATH,
      (from, to, rename) => {
        rename(from, to);
        if (!edited) writeFileSync(CONFIG_PATH, BROKEN);
        edited = true;
      },
      () => save(body)
    );
    assert.ok(edited, 'the save stored a secret before writing services.yaml');
    assert.equal(r.status, 409);
    assert.equal(fileText(), BROKEN, 'the hand edit is not overwritten');
    assertStoreAsBefore({ ...before, file: BROKEN });
  }
});

test('a save refused because services.yaml does not parse stores nothing either', async () => {
  for (const body of Object.values(SAVES)) {
    twoNpms();
    const before = snapshot();
    handEdit(BROKEN);
    const r = await save(body);
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'config_unparseable');
    assert.equal(secretsText(), before.secrets);
    assert.deepEqual(listSecretKeys(), before.names);
  }
});
