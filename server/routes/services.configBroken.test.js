/**
 * #423: while services.yaml doesn't parse, nothing JagHelm runs writes it.
 *
 * A read that yields no usable config keeps the last good one for the board
 * (#463), and at boot that is `{}`. The config read answered that config with
 * the broken file's version, so one indentation slip and then adding AdGuard
 * from the gallery rewrote services.yaml to that one integration; a Settings
 * save did the same. Now the read says the file doesn't parse (503
 * `config_unparseable`, with its line, and no version), every writer refuses
 * the same way, and the file stays byte-for-byte as it is until it is fixed
 * by hand.
 *
 * Its own file because the module's state is the point: the first tests run
 * against a fresh module, as at boot, with no good config to keep.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import yaml from 'js-yaml';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const { loadConfig, getConfig, readConfig, writeConfig, saveConfig } = await import('../config.js');
const { initSecrets, listSecretKeys } = await import('../secrets.js');
const { servicesRoutes } = await import('./services.js');
const { integrationRoutes } = await import('./integrations.js');
const { initRegistry } = await import('../integrations/registry.js');

initSecrets();
await initRegistry();

const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');

const app = express();
app.disable('etag'); // as index.js: no ETag but the routes' own
app.use(express.json({ limit: '1mb' }));
app.use('/api/services', servicesRoutes);
app.use('/api/integrations', integrationRoutes);

const read = () => request(app).get('/api/services/config');
const fileText = () => readFileSync(CONFIG_PATH, 'utf8');

const GOOD = [
  'nodes:',
  '  pi1:',
  '    display_name: Gateway',
  'services: {}',
  'integrations:',
  '  npm:',
  '    url: http://npm.example.test',
  "    password: 'hunter2-plaintext'", // pragma: allowlist secret
  '',
].join('\n');

// One indentation slip on line 4: the reviewer's reproduction.
const BROKEN = [
  'nodes:',
  '  pi1:',
  '    display_name: Gateway',
  '   visible: true',
  'integrations:',
  '  npm:',
  '    url: http://npm.example.test',
  "    password: 'hunter2-plaintext'", // pragma: allowlist secret
  '',
].join('\n');

/** The refusal every route answers while the file doesn't parse. */
function assertRefused(r, line = 4) {
  assert.equal(r.status, 503, r.text);
  assert.equal(r.body.code, 'config_unparseable');
  assert.equal(
    r.body.error,
    `services.yaml doesn't parse (line ${line}): fix it by hand; JagHelm won't save over it`
  );
  assert.equal(r.headers.etag, undefined, 'a refusal carries no version');
  assert.ok(!r.text.includes('hunter2'), 'the answer quotes the file');
}

/** Every writer of services.yaml, each sent as a browser would. */
const WRITERS = {
  'a Settings save': (version) =>
    request(app)
      .post('/api/services/config')
      .set('If-Match', version)
      .send({ nodes: { pi1: { display_name: 'Gateway' } }, services: {}, integrations: {} }),
  'adding an integration from the gallery': () =>
    request(app).post('/api/integrations/save').send({
      type: 'adguard',
      url: 'http://adguard.example.test',
      password: 'typed-in-the-form', // pragma: allowlist secret
      create: true,
    }),
  'an integration edit': () =>
    request(app).post('/api/integrations/save').send({
      type: 'npm',
      editingKey: 'npm',
      url: 'http://npm2.example.test',
      token: 'typed-token', // pragma: allowlist secret
    }),
  'an integration disabled': () =>
    request(app).patch('/api/integrations/npm').send({ enabled: false }),
  'an integration removed': () => request(app).delete('/api/integrations/npm'),
};

test('at boot, with no good config to keep, the read says the file does not parse', async () => {
  writeFileSync(CONFIG_PATH, BROKEN);
  // index.js at boot: a present but broken file is no first boot (#463).
  assert.deepEqual(loadConfig(), {});
  assertRefused(await read());
});

test('at boot, every writer is refused and the file is byte-for-byte unchanged', async (t) => {
  const secrets = listSecretKeys();
  for (const [name, send] of Object.entries(WRITERS)) {
    await t.test(name, async () => {
      // The version a tab could hold: none was ever answered, so any.
      assertRefused(await send('"any-version"'));
      assert.equal(fileText(), BROKEN);
    });
  }
  assert.deepEqual(listSecretKeys(), secrets, 'a refused save stored a credential');
  assert.deepEqual(getConfig(), {}, 'the board keeps what it had');
});

test('after a good config, every writer is refused while the file does not parse', async (t) => {
  for (const [name, send] of Object.entries(WRITERS)) {
    await t.test(name, async () => {
      writeFileSync(CONFIG_PATH, GOOD);
      loadConfig();
      // A tab read the good file, then the hand edit broke it.
      const before = await read();
      assert.equal(before.status, 200);
      writeFileSync(CONFIG_PATH, BROKEN);
      const secrets = listSecretKeys();

      assertRefused(await send(before.headers.etag));
      assert.equal(fileText(), BROKEN);
      assert.deepEqual(listSecretKeys(), secrets, 'a refused save stored a credential');
      // The read says so too, not the last good config under a version.
      assertRefused(await read());
      // The board keeps the last good config (#463).
      assert.equal(getConfig().nodes.pi1.display_name, 'Gateway');
    });
  }
});

test('a file that is empty, comments only or not a mapping is refused the same way', async (t) => {
  const cases = {
    empty: ['', 'services.yaml is empty'],
    'comments only': ['# being edited\n', 'services.yaml is empty'],
    'a list': ['- pi1\n- nas\n', "services.yaml isn't a mapping"],
  };
  for (const [name, [text, problem]] of Object.entries(cases)) {
    await t.test(name, async () => {
      writeFileSync(CONFIG_PATH, GOOD);
      loadConfig();
      writeFileSync(CONFIG_PATH, text);
      const want = `${problem}: fix it by hand; JagHelm won't save over it`;
      const r = await read();
      assert.equal(r.status, 503);
      assert.deepEqual(r.body, { error: want, code: 'config_unparseable' });
      const saved = await WRITERS['an integration disabled']();
      assert.equal(saved.status, 503);
      assert.equal(saved.body.error, want);
      assert.equal(fileText(), text);
    });
  }
});

test('fixing the file by hand makes saves work again, on the next read', async () => {
  writeFileSync(CONFIG_PATH, BROKEN);
  loadConfig();
  assertRefused(await read());
  // Fixed on disk; the watcher hasn't run.
  const fixed = BROKEN.replace('   visible: true', '    visible: true');
  writeFileSync(CONFIG_PATH, fixed);

  const again = await read();
  assert.equal(again.status, 200, again.text);
  assert.ok(again.headers.etag);
  assert.equal(again.body.nodes.pi1.visible, true);
  const cfg = structuredClone(again.body);
  cfg.nodes.pi1.visible = false;
  const saved = await request(app)
    .post('/api/services/config')
    .set('If-Match', again.headers.etag)
    .send(cfg);
  assert.equal(saved.status, 200, saved.text);
  const onDisk = yaml.load(fileText());
  assert.equal(onDisk.nodes.pi1.visible, false);
  assert.equal(onDisk.integrations.npm.password, 'hunter2-plaintext'); // pragma: allowlist secret
});

test('fixing the file by hand makes saves work again, after the watcher reloads it', async () => {
  writeFileSync(CONFIG_PATH, BROKEN);
  loadConfig();
  writeFileSync(CONFIG_PATH, GOOD);
  loadConfig(); // the watcher's reload
  const r = await WRITERS['an integration disabled']();
  assert.equal(r.status, 200, r.text);
  assert.equal(yaml.load(fileText()).integrations.npm.enabled, false);
});

test('writeConfig itself refuses a file that does not parse, whatever version it is given', () => {
  writeFileSync(CONFIG_PATH, BROKEN);
  const { version, unusable, config } = readConfig();
  assert.equal(config, null, 'no config is answered under the broken file');
  assert.match(unusable, /line 4/);
  // Even a caller that skipped the check and passes the file's own version.
  const saved = writeConfig({ nodes: {}, services: {} }, version);
  assert.equal(saved.ok, false);
  assert.equal(saved.unusable, unusable);
  assert.equal(saveConfig({ nodes: {}, services: {} }), false);
  assert.equal(fileText(), BROKEN);
});
