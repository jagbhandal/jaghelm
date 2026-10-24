/**
 * #414: a save never lands on a key another integration holds.
 *
 * A changed instance name moves an integration to its new key (#402). When
 * that key was already another integration's, the move deleted the old entry
 * and wrote over the other one, and its secrets with it: editing
 * adguard_secondary with the instance name "primary" left one AdGuard, and the
 * primary's URL, target and credential were gone. Now such a save is refused
 * with a 409 that names the other integration, and nothing changes. A new
 * integration added from the Settings form onto a taken key is refused the
 * same way.
 *
 * These drive the real route against the real config and secrets modules,
 * with the requests the web app sends (fixtures/settingsForm.js, which
 * sections/Integrations.test.jsx pins to the form).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import yaml from 'js-yaml';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const { loadConfig, getConfig } = await import('../config.js');
const { initSecrets, setSecret, hasSecret } = await import('../secrets.js');
const { initRegistry } = await import('../integrations/registry.js');
const { resolveIntegrationConfig } = await import('../integrations/lib/config.js');
const { integrationRoutes } = await import('./integrations.js');
const { ADGUARD_PRIMARY, ADGUARD_SECONDARY, CUSTOM_BUILDER } =
  await import('./fixtures/settingsForm.js');

initSecrets();
await initRegistry();

const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');
const SECRETS_PATH = join(process.env.JAGHELM_DATA_DIR, 'secrets.json');

const app = express();
app.use(express.json());
app.use('/api/integrations', integrationRoutes);
const save = (body) => request(app).post('/api/integrations/save').send(body);

const fileText = () => readFileSync(CONFIG_PATH, 'utf8');
const secretsText = () => (existsSync(SECRETS_PATH) ? readFileSync(SECRETS_PATH, 'utf8') : '');
const stored = () => yaml.load(fileText()).integrations;
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

const ADGUARD = {
  preset: 'adguard',
  url: 'http://adguard0.example.test:3000',
  username: 'admin',
  password: '$secret:integration_adguard_password', // pragma: allowlist secret
};

/** Three AdGuards and their stored credentials, written by hand. */
function threeAdguards() {
  setSecret('integration_adguard_password', 'pw-bare');
  setSecret('integration_adguard_primary_password', 'pw-primary');
  setSecret('integration_adguard_primary_url', 'http://keyed-primary.example.test');
  setSecret('integration_adguard_secondary_password', 'pw-secondary');
  handEdit(
    [
      '# Written by hand, so any rewrite of the file shows.',
      yaml.dump({
        integrations: {
          adguard: ADGUARD,
          [ADGUARD_PRIMARY.key]: ADGUARD_PRIMARY.entry,
          [ADGUARD_SECONDARY.key]: ADGUARD_SECONDARY.entry,
        },
      }),
    ].join('\n')
  );
}

// ── Acceptance 1: renaming onto an existing key is refused, nothing changes ──

test('renaming onto the key another integration holds is refused, and services.yaml and secrets.json stay byte-for-byte as they were', async () => {
  threeAdguards();
  const before = { file: fileText(), secrets: secretsText() };
  assert.ok(before.secrets, 'the secrets are on disk');

  const r = await save(ADGUARD_SECONDARY.renameToPrimary);
  assert.equal(r.status, ADGUARD_SECONDARY.refused.status);
  assert.deepEqual(r.body, ADGUARD_SECONDARY.refused.body);

  // A password typed in the same save would have been stored under the taken
  // key's name before the move; it is refused before anything is stored.
  const typed = await save({ ...ADGUARD_SECONDARY.renameToPrimary, password: 'pw-typed' }); // pragma: allowlist secret
  assert.deepEqual(typed.body, ADGUARD_SECONDARY.refused.body);

  assert.equal(fileText(), before.file, 'services.yaml untouched');
  assert.equal(secretsText(), before.secrets, 'secrets.json untouched');
  assert.equal(resolved('adguard_primary')._password, 'pw-primary');
  assert.equal(resolved('adguard_primary').url, 'http://keyed-primary.example.test');
  assert.equal(resolved('adguard_secondary')._password, 'pw-secondary');
});

test('clearing the instance name onto the bare preset key it would derive is refused too', async () => {
  threeAdguards();
  const before = { file: fileText(), secrets: secretsText() };
  const r = await save({ ...ADGUARD_SECONDARY.renameToPrimary, instance: undefined });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, {
    error: "AdGuard Home already uses the key 'adguard'; choose another instance name",
    field: 'instance',
  });
  assert.equal(fileText(), before.file);
  assert.equal(secretsText(), before.secrets);
});

test('the refusal names the integration holding the key as the Settings list does', async () => {
  // Custom integrations written by hand under keys the AdGuard form derives:
  // the list names one by the preset its key starts with, the other by its key.
  const custom = { url: 'http://stats.example.test', endpoint: '/stats', fields: [] };
  handEdit(
    yaml.dump({
      integrations: { adguard_stats: custom, [ADGUARD_SECONDARY.key]: ADGUARD_SECONDARY.entry },
    })
  );
  const before = fileText();
  const stats = await save({ ...ADGUARD_SECONDARY.renameToPrimary, instance: 'stats' });
  assert.equal(stats.status, 409);
  assert.deepEqual(stats.body, {
    error: "AdGuard Home already uses the key 'adguard_stats'; choose another instance name",
    field: 'instance',
  });
  assert.equal(fileText(), before);
  // One the list names by its key is named that way: the custom builder's
  // `_custom`, on the add path below.
});

// ── Acceptance 2: renaming onto a free key still moves it, credentials too ──

test('renaming onto a free key moves the entry and its credentials, and leaves the others alone', async () => {
  threeAdguards();
  const r = await save({ ...ADGUARD_SECONDARY.renameToPrimary, instance: 'tertiary' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, type: 'adguard_tertiary' });
  assert.deepEqual(stored(), {
    adguard: ADGUARD,
    adguard_primary: ADGUARD_PRIMARY.entry,
    adguard_tertiary: {
      ...ADGUARD_SECONDARY.entry,
      instance: 'tertiary',
      password: '$secret:integration_adguard_tertiary_password', // pragma: allowlist secret
    },
  });
  assert.equal(resolved('adguard_tertiary')._password, 'pw-secondary');
  assert.equal(hasSecret('integration_adguard_secondary_password'), false, 'the old name is gone');
  assert.equal(resolved('adguard_primary')._password, 'pw-primary');
  assert.equal(resolved('adguard_primary').url, 'http://keyed-primary.example.test');
  assert.equal(resolved('adguard')._password, 'pw-bare');
});

// ── A save under its own key is unaffected ──

test('a save that keeps its instance name is saved under its own key, other integrations present or not', async () => {
  threeAdguards();
  const before = fileText();
  assert.deepEqual((await save(ADGUARD_PRIMARY.saveUnchanged)).body, {
    ok: true,
    type: 'adguard_primary',
  });
  assert.equal(fileText(), before, 'nothing changed, nothing written');

  const r = await save({ ...ADGUARD_PRIMARY.saveUnchanged, url: 'http://moved.example.test' });
  assert.deepEqual(r.body, { ok: true, type: 'adguard_primary' });
  assert.equal(stored().adguard_primary.url, 'http://moved.example.test');
  assert.deepEqual(stored().adguard_secondary, ADGUARD_SECONDARY.entry);

  // npm_Two's instance is "two" to the form, which derives npm_two, a key
  // another integration holds; unchanged, it is saved where it is.
  const url = 'http://npm.example.test';
  handEdit(
    yaml.dump({
      integrations: {
        npm_Two: { preset: 'npm', instance: 'Two', url, username: 'u' },
        npm_two: { preset: 'npm', instance: 'two', url: 'http://other.example.test' },
      },
    })
  );
  const npmBefore = fileText();
  const two = await save({
    type: 'npm',
    url,
    instance: 'two',
    target: '',
    username: 'u',
    editingKey: 'npm_Two',
  });
  assert.deepEqual(two.body, { ok: true, type: 'npm_Two' });
  assert.equal(fileText(), npmBefore);
});

// ── The add path ──

test('a new integration added from the Settings form onto a taken key is refused the same way', async () => {
  threeAdguards();
  const before = { file: fileText(), secrets: secretsText() };
  // The gallery opens AdGuard as a new integration when only instance keys
  // hold it; the form then sends `create`.
  const r = await save({
    type: 'adguard',
    url: 'http://another-adguard.example.test',
    enabled: true,
    instance: 'primary',
    target: '',
    username: 'root',
    password: 'pw-new', // pragma: allowlist secret
    create: true,
  });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, ADGUARD_SECONDARY.refused.body);
  assert.equal(fileText(), before.file);
  assert.equal(secretsText(), before.secrets);

  // The custom builder has no instance field; its refusal says what to do instead.
  handEdit(yaml.dump({ integrations: { [CUSTOM_BUILDER.key]: CUSTOM_BUILDER.entry } }));
  const custom = await save(CUSTOM_BUILDER.add);
  assert.equal(custom.status, CUSTOM_BUILDER.refused.status);
  assert.deepEqual(custom.body, CUSTOM_BUILDER.refused.body);
  assert.deepEqual(stored(), { [CUSTOM_BUILDER.key]: CUSTOM_BUILDER.entry });

  // Onto a free key, it is added as before.
  const added = await save({
    type: 'adguard',
    url: 'http://another-adguard.example.test',
    enabled: true,
    instance: 'fourth',
    target: '',
    username: 'root',
    create: true,
  });
  assert.deepEqual(added.body, { ok: true, type: 'adguard_fourth' });
});

test('a save that does not say it is new still merges into the entry under its key, as an older web app relies on', async () => {
  // Before #402 the toggle posted { type: <key>, url, enabled, username } to
  // /save, with no editingKey; a cached older web app still can.
  threeAdguards();
  const { url, username } = ADGUARD_PRIMARY.entry;
  const r = await save({ type: 'adguard_primary', url, enabled: false, username });
  assert.deepEqual(r.body, { ok: true, type: 'adguard_primary' });
  assert.deepEqual(stored().adguard_primary, { ...ADGUARD_PRIMARY.entry, enabled: false });
});
