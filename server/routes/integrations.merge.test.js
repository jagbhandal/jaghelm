/**
 * #402: a save in Settings and the enable toggle change only what they own.
 *
 * The save used to rebuild an integration's services.yaml entry from the form,
 * so whatever the form doesn't send was lost: a custom integration's endpoint,
 * auth, header and fields, and a credential under a secret name Settings
 * doesn't derive. The toggle went through the same save with even less, so it
 * also dropped the target, the URL params and, for an instance key such as
 * adguard_primary, the preset. Now the save merges the form into the stored
 * entry and the toggle sets `enabled` and nothing else.
 *
 * These drive the real routes against the real config and secrets modules,
 * with the requests the web app sends (fixtures/settingsForm.js, which
 * IntegrationsTab.test.jsx pins to the form).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import yaml from 'js-yaml';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const { loadConfig, saveConfig, getConfig } = await import('../config.js');
const { initSecrets, getSecret, listSecretKeys } = await import('../secrets.js');
const { initRegistry } = await import('../integrations/registry.js');
const { integrationRoutes } = await import('./integrations.js');
const { STATUSPAGE, ADGUARD_PRIMARY } = await import('./fixtures/settingsForm.js');

initSecrets();
await initRegistry();

const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');

const app = express();
app.use(express.json());
app.use('/api/integrations', integrationRoutes);
const save = (body) => request(app).post('/api/integrations/save').send(body);
const send = ({ method, path, body }) => request(app)[method.toLowerCase()](path).send(body);

const fileText = () => readFileSync(CONFIG_PATH, 'utf8');
/** `obj` without `keys`. */
const without = (obj, ...keys) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
const stored = () => yaml.load(fileText()).integrations;
/** Put `text` on disk and load it, as the config watcher does after a hand edit. */
function handEdit(text) {
  writeFileSync(CONFIG_PATH, text);
  loadConfig();
}

// Written by hand: comments, quoting and flow style that JagHelm's own writer
// would not produce, so any rewrite of the file shows.
const HAND_WRITTEN = [
  '# Written by hand, not by JagHelm.',
  'nodes: {}',
  '',
  'integrations:',
  '  # A status page that wants an API key in a header.',
  '  statuspage:',
  '    url: "http://status.example.test"',
  '    endpoint: /api/summary',
  '    auth: header',
  '    authHeader: X-Api-Key',
  '    token: $secret:statuspage_key', // pragma: allowlist secret
  '    fields:',
  '      - { key: up, label: Up, path: summary.up }',
  '  adguard_primary:',
  '    preset: adguard',
  '    instance: primary',
  '    url: http://adguard.example.test:3000',
  '    username: admin',
  '    password: $secret:integration_adguard_primary_password', // pragma: allowlist secret
  '    target: "pi1:adguard"',
  '  cloudflare:',
  '    preset: cloudflare',
  '    url: https://api.cloudflare.com',
  '    token: $secret:integration_cloudflare_token', // pragma: allowlist secret
  '    account_id: abc123',
  '',
].join('\n');

const CLOUDFLARE = {
  preset: 'cloudflare',
  url: 'https://api.cloudflare.com',
  token: '$secret:integration_cloudflare_token', // pragma: allowlist secret
  account_id: 'abc123',
};
// What the form sends for the cloudflare entry, saved unchanged: the preset has
// one URL param, so every save sends it.
const CLOUDFLARE_SAVE = {
  type: 'cloudflare',
  url: 'https://api.cloudflare.com',
  enabled: true,
  target: '',
  username: '',
  params: { account_id: 'abc123' },
  editingKey: 'cloudflare',
};

test('the hand-written file holds the entries the form fixtures were taken from', () => {
  assert.deepEqual(yaml.load(HAND_WRITTEN).integrations, {
    statuspage: STATUSPAGE.entry,
    adguard_primary: ADGUARD_PRIMARY.entry,
    cloudflare: CLOUDFLARE,
  });
});

// ── Acceptance 1: a save with nothing changed leaves the file as it was ──

test('saving a hand-written custom integration unchanged in Settings leaves services.yaml byte-for-byte unchanged', async () => {
  handEdit(HAND_WRITTEN);
  const r = await save(STATUSPAGE.saveUnchanged);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, type: 'statuspage' });
  assert.equal(fileText(), HAND_WRITTEN, 'not rewritten at all');
  assert.deepEqual(getConfig().integrations, yaml.load(HAND_WRITTEN).integrations);

  // An older web app leaves out a blank target and username: the same.
  assert.equal((await save(without(STATUSPAGE.saveUnchanged, 'target', 'username'))).status, 200);
  assert.equal(fileText(), HAND_WRITTEN);
});

test('saving a gallery integration unchanged, password left blank, leaves the file unchanged too', async () => {
  handEdit(HAND_WRITTEN);
  for (const body of [ADGUARD_PRIMARY.saveUnchanged, CLOUDFLARE_SAVE]) {
    const r = await save(body);
    assert.equal(r.status, 200, body.type);
    assert.equal(fileText(), HAND_WRITTEN, body.type);
  }
});

test('a save that changes only enabled changes only that line of a file JagHelm wrote', async () => {
  saveConfig(yaml.load(HAND_WRITTEN)); // JagHelm's own formatting, as after any save from Settings
  const before = fileText();
  const last = '        path: summary.up\n'; // the statuspage entry's last line

  assert.equal((await save({ ...STATUSPAGE.saveUnchanged, enabled: false })).status, 200);
  const disabled = fileText();
  assert.equal(disabled, before.replace(last, `${last}    enabled: false\n`));

  assert.equal((await save(STATUSPAGE.saveUnchanged)).status, 200);
  assert.equal(fileText(), disabled.replace('    enabled: false\n', '    enabled: true\n'));
});

test('a save that changes enabled in a hand-formatted file keeps every value but enabled', async () => {
  // Any write re-serialises services.yaml in JagHelm's format (comments and
  // quoting go), as every save from Settings always has; the values stay.
  handEdit(HAND_WRITTEN);
  assert.equal((await save({ ...STATUSPAGE.saveUnchanged, enabled: false })).status, 200);
  assert.deepEqual(stored(), {
    statuspage: { ...STATUSPAGE.entry, enabled: false },
    adguard_primary: ADGUARD_PRIMARY.entry,
    cloudflare: CLOUDFLARE,
  });
});

// ── Acceptance 2: the toggle changes only enabled ──

test('the enable toggle on adguard_primary keeps its preset, instance, target and credential', async () => {
  handEdit(HAND_WRITTEN);
  const r = await send(ADGUARD_PRIMARY.disable);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, type: 'adguard_primary', enabled: false });
  assert.deepEqual(stored(), {
    statuspage: STATUSPAGE.entry,
    adguard_primary: { ...ADGUARD_PRIMARY.entry, enabled: false },
    cloudflare: CLOUDFLARE,
  });

  const enable = { ...ADGUARD_PRIMARY.disable, body: { enabled: true } };
  assert.equal((await send(enable)).status, 200);
  assert.deepEqual(stored().adguard_primary, { ...ADGUARD_PRIMARY.entry, enabled: true });
});

test("the toggle keeps a URL param (cloudflare account_id) and a custom entry's endpoint, auth and fields", async () => {
  handEdit(HAND_WRITTEN);
  for (const key of ['cloudflare', 'statuspage']) {
    const r = await send({
      method: 'PATCH',
      path: `/api/integrations/${key}`,
      body: { enabled: false },
    });
    assert.equal(r.status, 200, key);
  }
  assert.deepEqual(stored(), {
    statuspage: { ...STATUSPAGE.entry, enabled: false },
    adguard_primary: ADGUARD_PRIMARY.entry,
    cloudflare: { ...CLOUDFLARE, enabled: false },
  });
});

test('the toggle changes only the enabled line of a file JagHelm wrote', async () => {
  saveConfig(yaml.load(HAND_WRITTEN));
  const before = fileText();
  const target = before.split('\n').find((l) => l.startsWith('    target: '));
  assert.ok(target, 'adguard_primary has a target line');

  assert.equal((await send(ADGUARD_PRIMARY.disable)).status, 200);
  assert.equal(fileText(), before.replace(`${target}\n`, `${target}\n    enabled: false\n`));
});

test('the toggle to the state an integration is already in writes nothing', async () => {
  handEdit(HAND_WRITTEN);
  const enable = { ...ADGUARD_PRIMARY.disable, body: { enabled: true } };
  const r = await send(enable);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, type: 'adguard_primary', enabled: true });
  assert.equal(fileText(), HAND_WRITTEN);
});

test('the toggle takes only { enabled: true|false } for an integration that is configured', async () => {
  handEdit(HAND_WRITTEN);
  const patch = (key, body) => send({ method: 'PATCH', path: `/api/integrations/${key}`, body });
  for (const key of ['never_configured', '__proto__', 'constructor', 'toString']) {
    const r = await patch(key, { enabled: false });
    assert.equal(r.status, 404, key);
  }
  for (const body of [
    {},
    { enabled: 'false' },
    { enabled: 0 },
    { enabled: false, url: 'http://x' },
  ]) {
    const r = await patch('adguard_primary', body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(fileText(), HAND_WRITTEN, 'none of them wrote');
});

test("an older web app's toggle (a save with the key as its type) keeps the entry too", async () => {
  // Before this fix the toggle posted { type: <key>, url, enabled, username } to
  // /save. A cached older web app still can.
  handEdit(HAND_WRITTEN);
  const { url, username } = ADGUARD_PRIMARY.entry;
  const r = await save({ type: 'adguard_primary', url, enabled: false, username });
  assert.equal(r.status, 200);
  assert.equal(r.body.type, 'adguard_primary');
  assert.deepEqual(stored().adguard_primary, { ...ADGUARD_PRIMARY.entry, enabled: false });

  const r2 = await save({ type: 'statuspage', url: STATUSPAGE.entry.url, enabled: false });
  assert.equal(r2.status, 200);
  assert.deepEqual(stored().statuspage, { ...STATUSPAGE.entry, enabled: false });
});

// ── Acceptance 3: a blank password keeps the stored credential ──

test('a blank password keeps the stored credential; a typed one replaces it', async () => {
  saveConfig({ integrations: {} });
  const url = 'http://npm.example.test';
  const added = await save({ type: 'npm', url, enabled: true, username: 'u', password: 'old-pw' });
  assert.equal(added.status, 200);
  const entry = getConfig().integrations.npm;
  assert.equal(entry.password, '$secret:integration_npm_password'); // pragma: allowlist secret
  assert.equal(getSecret('integration_npm_password'), 'old-pw');

  const edit = { type: 'npm', url, enabled: true, target: '', username: 'u', editingKey: 'npm' };
  const before = fileText();
  assert.equal((await save(edit)).status, 200);
  assert.equal(fileText(), before, 'nothing to write');
  assert.equal(getSecret('integration_npm_password'), 'old-pw');

  assert.equal((await save({ ...edit, password: 'new-pw' })).status, 200);
  assert.deepEqual(getConfig().integrations.npm, entry, 'the entry already names the secret');
  assert.equal(getSecret('integration_npm_password'), 'new-pw');
});

test('a blank password or token keeps a credential written by hand, under any name or in the file', async () => {
  const nas = {
    url: 'http://nas.example.test',
    endpoint: '/status',
    auth: 'basic',
    username: 'u',
    password: 'hunter2', // pragma: allowlist secret
  };
  handEdit(yaml.dump({ integrations: { nas, statuspage: STATUSPAGE.entry } }));
  const edit = {
    type: 'nas',
    url: nas.url,
    enabled: true,
    target: '',
    username: 'u',
    editingKey: 'nas',
  };
  const before = fileText();
  assert.equal((await save(edit)).status, 200);
  assert.equal((await save(STATUSPAGE.saveUnchanged)).status, 200);
  assert.equal(
    fileText(),
    before,
    'the password in the file and the $secret: under its own name stay'
  );

  // A typed password goes to the secrets store under the name Settings gives it.
  assert.equal((await save({ ...edit, password: 'typed-pw' })).status, 200);
  assert.deepEqual(stored().nas, { ...nas, password: '$secret:integration_nas_password' }); // pragma: allowlist secret
  assert.equal(getSecret('integration_nas_password'), 'typed-pw');

  // And a typed token, for the custom entry whose token was under another name.
  assert.equal((await save({ ...STATUSPAGE.saveUnchanged, token: 'typed-token' })).status, 200);
  assert.deepEqual(stored().statuspage, {
    ...STATUSPAGE.entry,
    token: '$secret:integration_statuspage_token', // pragma: allowlist secret
  });
  assert.equal(getSecret('integration_statuspage_token'), 'typed-token');
});

test('a credential is never sent back or logged', async () => {
  const written = [];
  const capture = (stream) => {
    const orig = stream.write;
    stream.write = function (chunk, ...rest) {
      written.push(String(chunk));
      return orig.call(this, chunk, ...rest);
    };
    return () => {
      stream.write = orig;
    };
  };
  const restore = [capture(process.stdout), capture(process.stderr)];
  let bodies;
  try {
    handEdit(HAND_WRITTEN);
    bodies = [
      (await save({ ...ADGUARD_PRIMARY.saveUnchanged, password: 'leak-check-pw' })).text, // pragma: allowlist secret
      (await save({ ...STATUSPAGE.saveUnchanged, token: 'leak-check-token' })).text, // pragma: allowlist secret
      (await send(ADGUARD_PRIMARY.disable)).text,
    ];
  } finally {
    for (const r of restore) r();
  }
  for (const text of [...bodies, ...written]) {
    assert.doesNotMatch(text, /leak-check-/);
    assert.doesNotMatch(text, /\$secret:/);
  }
  assert.ok(listSecretKeys().includes('integration_adguard_primary_password'));
});

// ── What the form owns, it can clear ──

test('a target, a username or a URL param emptied in the form is removed; an empty URL is refused', async () => {
  handEdit(HAND_WRITTEN);
  assert.equal((await save({ ...ADGUARD_PRIMARY.saveUnchanged, target: '' })).status, 200);
  assert.deepEqual(stored().adguard_primary, without(ADGUARD_PRIMARY.entry, 'target'));

  assert.equal(
    (await save({ ...ADGUARD_PRIMARY.saveUnchanged, target: '', username: '' })).status,
    200
  );
  assert.deepEqual(
    stored().adguard_primary,
    without(ADGUARD_PRIMARY.entry, 'target', 'username'),
    'the stored password stays'
  );

  assert.equal((await save({ ...CLOUDFLARE_SAVE, params: { account_id: '' } })).status, 200);
  assert.deepEqual(stored().cloudflare, without(CLOUDFLARE, 'account_id'));

  handEdit(HAND_WRITTEN);
  for (const url of ['', '   ']) {
    const r = await save({ ...STATUSPAGE.saveUnchanged, url });
    assert.equal(r.status, 400, JSON.stringify(url));
  }
  assert.equal(fileText(), HAND_WRITTEN);
});

test('a changed URL, username, target or URL param replaces the stored one and keeps the rest', async () => {
  handEdit(HAND_WRITTEN);
  const r = await save({
    ...ADGUARD_PRIMARY.saveUnchanged,
    url: 'adguard2.example.test:3000',
    username: 'root',
    target: 'pi2:adguard',
  });
  assert.equal(r.status, 200);
  assert.deepEqual(stored().adguard_primary, {
    ...ADGUARD_PRIMARY.entry,
    url: 'http://adguard2.example.test:3000',
    username: 'root',
    target: 'pi2:adguard',
  });

  assert.equal(
    (await save({ ...CLOUDFLARE_SAVE, params: { account_id: 'xyz', tlsSkip: true } })).status,
    200
  );
  assert.deepEqual(
    stored().cloudflare,
    { ...CLOUDFLARE, account_id: 'xyz' },
    'a param the preset does not declare is dropped'
  );
});

test('a changed instance name moves the entry to its new key and keeps its credential', async () => {
  handEdit(HAND_WRITTEN);
  const r = await save({ ...ADGUARD_PRIMARY.saveUnchanged, instance: 'secondary' });
  assert.equal(r.status, 200);
  assert.equal(r.body.type, 'adguard_secondary');
  const after = stored();
  assert.equal(after.adguard_primary, undefined);
  assert.deepEqual(after.adguard_secondary, { ...ADGUARD_PRIMARY.entry, instance: 'secondary' });
});

test('an entry under a key Settings would not derive is saved where it is', async () => {
  const url = 'http://npm.example.test';
  handEdit(
    yaml.dump({
      integrations: {
        my_npm: { preset: 'npm', url, username: 'u' },
        npm_Two: { preset: 'npm', instance: 'Two', url, username: 'u' },
      },
    })
  );
  const before = fileText();
  const edit = { type: 'npm', url, enabled: true, target: '', username: 'u' };
  const mine = await save({ ...edit, editingKey: 'my_npm' });
  assert.deepEqual(mine.body, { ok: true, type: 'my_npm' });
  // The form lowercases an instance name, so it sends "two" for "Two".
  const two = await save({ ...edit, instance: 'two', editingKey: 'npm_Two' });
  assert.deepEqual(two.body, { ok: true, type: 'npm_Two' });
  assert.equal(fileText(), before);
});

test('a new integration from the gallery is written as before', async () => {
  saveConfig({ integrations: {} });
  const r = await save({
    type: 'adguard',
    url: 'adguard.example.test:3000',
    enabled: true,
    instance: 'primary',
    target: '',
    username: 'admin',
    password: 'new-pw',
  });
  assert.deepEqual(r.body, { ok: true, type: 'adguard_primary' });
  const entry = stored().adguard_primary;
  assert.deepEqual(entry, {
    url: 'http://adguard.example.test:3000',
    enabled: true,
    preset: 'adguard',
    instance: 'primary',
    username: 'admin',
    password: '$secret:integration_adguard_primary_password', // pragma: allowlist secret
  });
  assert.deepEqual(Object.keys(entry), [
    'url',
    'enabled',
    'preset',
    'instance',
    'username',
    'password',
  ]);
});
