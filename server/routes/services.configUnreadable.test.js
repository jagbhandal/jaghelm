/**
 * #536: while services.yaml can't be read, nothing JagHelm runs writes it.
 *
 * A Settings save must never write over a file it couldn't read: the config
 * read and every writer (the config save, the integration save, toggle and
 * delete) answer a 503 `config_unreadable`, the shape of #423's
 * `config_unparseable`, before a credential is stored, and the file stays
 * byte-for-byte as it is. It used to be a 500 for the read and the save.
 *
 * Reads fail through a stand-in for readFileSync, as a permission change does
 * (the file stays, and could still be written over), so it runs as root too;
 * a real directory in its place (EISDIR) is refused the same way.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const { loadConfig } = await import('../config.js');
const { initSecrets, listSecretKeys } = await import('../secrets.js');
const { servicesRoutes } = await import('./services.js');
const { integrationRoutes } = await import('./integrations.js');
const { initRegistry } = await import('../integrations/registry.js');

initSecrets();
await initRegistry();

const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');

const realRead = fs.readFileSync;
let blocked = null;
fs.readFileSync = function readFileSync(path, ...rest) {
  if (path === CONFIG_PATH && blocked && fs.existsSync(path)) {
    throw Object.assign(new Error(`${blocked}: blocked, open '${path}'`), { code: blocked });
  }
  return realRead(path, ...rest);
};
syncBuiltinESMExports();
after(() => {
  fs.readFileSync = realRead;
  syncBuiltinESMExports();
});

const app = express();
app.disable('etag');
app.use(express.json({ limit: '1mb' }));
app.use('/api/services', servicesRoutes);
app.use('/api/integrations', integrationRoutes);

const read = () => request(app).get('/api/services/config');
const fileText = () => realRead(CONFIG_PATH, 'utf8');

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

/** The refusal every route answers while the file can't be read. */
function assertRefused(r, words = 'permission denied') {
  assert.equal(r.status, 503, r.text);
  assert.deepEqual(r.body, {
    error: `services.yaml can't be read (${words}): fix it on the host; JagHelm won't save over a file it can't read`,
    code: 'config_unreadable',
  });
  assert.equal(r.headers.etag, undefined, 'a refusal carries no version');
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

test('at boot, the config read says the file can not be read, not a 500', async () => {
  fs.writeFileSync(CONFIG_PATH, GOOD);
  blocked = 'EACCES';
  assert.deepEqual(loadConfig(), {});
  assertRefused(await read());
});

test('after a good read, every writer is refused while the file can not be read, and the file is untouched', async (t) => {
  for (const [name, send] of Object.entries(WRITERS)) {
    await t.test(name, async () => {
      blocked = null;
      fs.writeFileSync(CONFIG_PATH, GOOD);
      loadConfig();
      // A tab read the good file, then its permissions changed.
      const before = await read();
      assert.equal(before.status, 200);
      blocked = 'EACCES';
      const secrets = listSecretKeys();

      assertRefused(await send(before.headers.etag));
      assert.equal(fileText(), GOOD);
      assert.deepEqual(listSecretKeys(), secrets, 'a refused save stored a credential');
      assertRefused(await read());
    });
  }
});

test('readable again: the next read answers it and saves work', async () => {
  blocked = null;
  const again = await read();
  assert.equal(again.status, 200, again.text);
  const r = await WRITERS['an integration disabled']();
  assert.equal(r.status, 200, r.text);
});

test('a directory in its place (EISDIR) is refused the same way and left as it is', async () => {
  fs.rmSync(CONFIG_PATH, { force: true });
  fs.mkdirSync(CONFIG_PATH);
  try {
    assertRefused(await read(), "it's a directory");
    assertRefused(await WRITERS['a Settings save']('"absent"'), "it's a directory");
    assert.equal(fs.statSync(CONFIG_PATH).isDirectory(), true);
  } finally {
    fs.rmSync(CONFIG_PATH, { recursive: true, force: true });
  }
});
