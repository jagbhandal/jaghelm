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
const { initSecrets, getSecret, setSecret, hasSecret, listSecretKeys } =
  await import('../secrets.js');
const { initRegistry } = await import('../integrations/registry.js');
const { resolveIntegrationConfig } = await import('../integrations/lib/config.js');
const { integrationRoutes } = await import('./integrations.js');
const { STATUSPAGE, ADGUARD_PRIMARY, ZEROS } = await import('./fixtures/settingsForm.js');

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
/** What the refresh loop resolves the entry under `key` to (credentials included). */
function resolved(key) {
  const cfg = getConfig().integrations[key];
  return resolveIntegrationConfig(cfg.preset || key, { ...cfg, _storageKey: key });
}
const patch = (key, body) => send({ method: 'PATCH', path: `/api/integrations/${key}`, body });
/** Everything the server logs while `fn` runs. */
async function logsOf(fn) {
  const written = [];
  const restore = [process.stdout, process.stderr].map((stream) => {
    const orig = stream.write;
    stream.write = function (chunk, ...rest) {
      written.push(String(chunk));
      return orig.call(this, chunk, ...rest);
    };
    return () => {
      stream.write = orig;
    };
  });
  try {
    const result = await fn();
    return { result, logs: written.join('') };
  } finally {
    for (const r of restore) r();
  }
}
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

test('Enabled changed in the form: the save leaves it alone, and the toggle route changes only its line of a file JagHelm wrote', async () => {
  saveConfig(yaml.load(HAND_WRITTEN)); // JagHelm's own formatting, as after any save from Settings
  const before = fileText();
  const last = '        path: summary.up\n'; // the statuspage entry's last line

  // An edit leaves `enabled` to the toggle route, whatever its body says.
  assert.equal((await save({ ...STATUSPAGE.saveUnchanged, enabled: false })).status, 200);
  assert.equal(fileText(), before);

  // The form sends the change there after the save.
  assert.equal((await patch('statuspage', { enabled: false })).status, 200);
  const disabled = fileText();
  assert.equal(disabled, before.replace(last, `${last}    enabled: false\n`));

  assert.equal((await patch('statuspage', { enabled: true })).status, 200);
  assert.equal(fileText(), disabled.replace('    enabled: false\n', '    enabled: true\n'));
});

test('a toggle on a hand-formatted file keeps every value but enabled', async () => {
  // Any write re-serialises services.yaml in JagHelm's format, so comments and
  // quoting go, as every write from Settings always has; the values stay.
  handEdit(HAND_WRITTEN);
  assert.equal((await patch('statuspage', { enabled: false })).status, 200);
  assert.deepEqual(stored(), {
    statuspage: { ...STATUSPAGE.entry, enabled: false },
    adguard_primary: ADGUARD_PRIMARY.entry,
    cloudflare: CLOUDFLARE,
  });
});

test('a Settings form left open does not undo a toggle made since', async () => {
  handEdit(HAND_WRITTEN);
  assert.equal((await send(ADGUARD_PRIMARY.disable)).status, 200);
  // The form was opened while it was enabled. Saved unchanged, or by an older
  // web app that sent the box's state with every save:
  for (const body of [
    ADGUARD_PRIMARY.saveUnchanged,
    { ...ADGUARD_PRIMARY.saveUnchanged, enabled: true },
  ]) {
    assert.equal((await save(body)).status, 200);
    assert.equal(stored().adguard_primary.enabled, false, JSON.stringify(body));
  }
});

test('a value that is set but falsy (0) survives an unchanged save', async () => {
  handEdit(yaml.dump({ integrations: { [ZEROS.key]: ZEROS.entry } }));
  const before = fileText();
  assert.equal((await save(ZEROS.saveUnchanged)).status, 200);
  assert.equal(fileText(), before);
});

test("a save never changes an existing entry's preset: a custom adguard_stats saved from the AdGuard form", async () => {
  // The list guesses the AdGuard form from the key's prefix, so the save
  // names the adguard preset for an entry that has none.
  const text = [
    'integrations:',
    '  adguard_stats:',
    '    url: http://adguard.example.test:3000',
    '    endpoint: /control/stats',
    '    fields: [{ key: q, label: Queries, path: num_dns_queries }]',
    '',
  ].join('\n');
  handEdit(text);
  const r = await save({
    type: 'adguard',
    url: 'http://adguard.example.test:3000',
    target: '',
    username: '',
    editingKey: 'adguard_stats',
  });
  assert.deepEqual(r.body, { ok: true, type: 'adguard_stats' });
  assert.equal(fileText(), text, 'still a custom integration, under its own key');
});

test('a save for an entry removed since its form was opened is refused, not merged into another', async () => {
  const npm = {
    preset: 'npm',
    url: 'http://npm-real.example.test',
    username: 'real',
    target: 'pi1:npm',
  };
  handEdit(yaml.dump({ integrations: { npm, gone: null } }));
  const before = fileText();
  // my_npm was deleted in another tab; its form would derive the key npm.
  for (const editingKey of ['my_npm', 'gone']) {
    const r = await save({
      type: 'npm',
      url: 'http://my-npm.example.test',
      target: '',
      username: 'mine',
      editingKey,
    });
    assert.equal(r.status, 409, editingKey);
    assert.match(r.body.error, /no longer configured; reload Settings/);
  }
  assert.equal(fileText(), before, 'npm untouched');
});

test('a password or token that is not text is refused, stores nothing and is never logged', async () => {
  handEdit(HAND_WRITTEN);
  const bodies = [
    { type: 'npm', instance: 'numeric', url: 'http://n.example.test', password: 987654321 },
    { type: 'npm', instance: 'numeric', url: 'http://n.example.test', token: 987654321 },
    { ...STATUSPAGE.saveUnchanged, token: { value: 987654321 } },
    { ...ADGUARD_PRIMARY.saveUnchanged, password: true },
  ];
  const { result, logs } = await logsOf(() => Promise.all(bodies.map(save)));
  for (const r of result) {
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'password and token must be text' });
  }
  assert.doesNotMatch(logs, /987654321/);
  assert.ok(!listSecretKeys().some((k) => k.startsWith('integration_npm_numeric_')));
  assert.equal(fileText(), HAND_WRITTEN);
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
  handEdit(HAND_WRITTEN);
  const { result: bodies, logs } = await logsOf(async () => [
    (await save({ ...ADGUARD_PRIMARY.saveUnchanged, password: 'leak-check-pw' })).text, // pragma: allowlist secret
    (await save({ ...STATUSPAGE.saveUnchanged, token: 'leak-check-token' })).text, // pragma: allowlist secret
    (await send(ADGUARD_PRIMARY.disable)).text,
  ]);
  for (const text of [...bodies, logs]) {
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
    // A new address takes the password typed again (#556); it is stored
    // under the name the entry already names.
    password: 'pw-for-adguard2', // pragma: allowlist secret
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

test('a changed instance name moves the entry and its credentials to the new key', async () => {
  setSecret('integration_adguard_primary_password', 'pw-primary');
  // Left under the new key by an integration deleted earlier (DELETE keeps
  // its secrets): neither may stand in for the moved entry's own.
  setSecret('integration_adguard_secondary_password', 'pw-stale');
  setSecret('integration_adguard_secondary_url', 'http://stale.example.test');
  handEdit(HAND_WRITTEN);
  const r = await save({ ...ADGUARD_PRIMARY.saveUnchanged, instance: 'secondary' });
  assert.equal(r.status, 200);
  assert.equal(r.body.type, 'adguard_secondary');
  const after = stored();
  assert.equal(after.adguard_primary, undefined);
  assert.deepEqual(after.adguard_secondary, {
    ...ADGUARD_PRIMARY.entry,
    instance: 'secondary',
    password: '$secret:integration_adguard_secondary_password', // pragma: allowlist secret
  });
  assert.equal(resolved('adguard_secondary')._password, 'pw-primary');
  assert.equal(resolved('adguard_secondary').url, ADGUARD_PRIMARY.entry.url);
  assert.equal(hasSecret('integration_adguard_primary_password'), false, 'the old name is gone');
  assert.equal(hasSecret('integration_adguard_secondary_url'), false, 'the stale one is gone');

  // An entry that names no secret: its preset resolves the one under its key.
  setSecret('integration_npm_two_password', 'pw-two');
  setSecret('integration_npm_three_password', 'pw-stale');
  const npm = { preset: 'npm', instance: 'two', url: 'http://npm.example.test', username: 'u' };
  handEdit(yaml.dump({ integrations: { npm_two: npm } }));
  const edit = { type: 'npm', url: npm.url, target: '', username: 'u', editingKey: 'npm_two' };
  assert.equal((await save({ ...edit, instance: 'three' })).status, 200);
  assert.deepEqual(stored(), { npm_three: { ...npm, instance: 'three' } });
  assert.equal(resolved('npm_three')._password, 'pw-two');
  assert.equal(hasSecret('integration_npm_two_password'), false);

  // A password typed in the same save is the one stored under the new key.
  const typed = { ...edit, instance: 'four', editingKey: 'npm_three', password: 'pw-typed' }; // pragma: allowlist secret
  assert.equal((await save(typed)).status, 200);
  assert.equal(resolved('npm_four')._password, 'pw-typed');
  assert.equal(stored().npm_four.password, '$secret:integration_npm_four_password'); // pragma: allowlist secret
  assert.equal(hasSecret('integration_npm_three_password'), false);
});

test("a new integration added under a renamed one's old key leaves the renamed one's credential alone", async () => {
  setSecret('integration_adguard_primary_password', 'pw-primary');
  handEdit(HAND_WRITTEN);
  assert.equal(
    (await save({ ...ADGUARD_PRIMARY.saveUnchanged, instance: 'secondary' })).status,
    200
  );
  const added = await save({
    type: 'adguard',
    url: 'http://other-adguard.example.test',
    enabled: true,
    instance: 'primary',
    target: '',
    username: 'x',
    password: 'pw-new-primary', // pragma: allowlist secret
  });
  assert.deepEqual(added.body, { ok: true, type: 'adguard_primary' });
  assert.equal(resolved('adguard_primary')._password, 'pw-new-primary');
  assert.equal(resolved('adguard_secondary')._password, 'pw-primary');
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
