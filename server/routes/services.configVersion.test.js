/**
 * #423: a Settings tab can save the config only over the version it read.
 *
 * POST /api/services/config replaces services.yaml with what the browser
 * sends. A tab left open from before a change posted its old copy, which
 * has no entry for what was added since, so the save deleted it. Now
 * GET /api/services/config answers with the file's version as a strong ETag
 * (a SHA-256 of services.yaml's bytes), and the POST must carry it back in
 * If-Match: none is a 428, an old one a 409, and nothing is written either
 * way. A save answers with the new version, so the tab can save again.
 *
 * Every writer of services.yaml (this route and the integration routes) reads
 * the file and writes it in one synchronous step that checks the version
 * first, so nothing can write in between.
 *
 * These drive the real routes against the real config module and file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import yaml from 'js-yaml';

const { loadConfig, getConfig } = await import('../config.js');
const { servicesRoutes } = await import('./services.js');
const { integrationRoutes } = await import('./integrations.js');
const { initRegistry } = await import('../integrations/registry.js');

await initRegistry();

const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');

/**
 * A POST that arrives while `gate` is set waits there until `gate.size` have
 * arrived, then all of them go on, one after the other in the same tick: two
 * saves that both passed the body parser with the same version before either
 * was handled, the closest two requests can race.
 */
let gate = null;
function holdPosts(size) {
  const waiting = [];
  gate = {
    arrive(next) {
      waiting.push(next);
      if (waiting.length < size) return;
      gate = null;
      for (const go of waiting) go();
    },
  };
}

const app = express();
app.disable('etag'); // as index.js: no ETag but the routes' own
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => (gate && req.method === 'POST' ? gate.arrive(next) : next()));
app.use('/api/services', servicesRoutes);
app.use('/api/integrations', integrationRoutes);

const read = () => request(app).get('/api/services/config');
const write = (body, version) => {
  const r = request(app).post('/api/services/config');
  if (version !== undefined) r.set('If-Match', version);
  return r.send(body);
};

const fileText = () => readFileSync(CONFIG_PATH, 'utf8');
/** The file's version as the server computes it: a SHA-256 of its bytes. */
const fileVersion = () =>
  `"${createHash('sha256').update(readFileSync(CONFIG_PATH)).digest('base64url')}"`;
/** Put `text` on disk and load it, as the config watcher does after a hand edit. */
function handEdit(text) {
  writeFileSync(CONFIG_PATH, text);
  loadConfig();
}

const START = [
  '# Written by hand.',
  'nodes:',
  '  pi1:',
  '    display_name: Gateway',
  '    visible: true',
  '  nas:',
  '    display_name: NAS',
  'services: {}',
  'integrations:',
  '  npm:',
  '    url: http://npm.example.test',
  '    username: admin',
  "    password: 'hunter2-plaintext'", // pragma: allowlist secret
  '',
].join('\n');

/** `cfg` (a read's answer) with node `key`'s `visible` set to `visible`. */
const withVisible = (cfg, key, visible) => ({
  ...cfg,
  nodes: { ...cfg.nodes, [key]: { ...cfg.nodes[key], visible } },
});

test('GET /config answers with the file version as a strong, quoted ETag', async () => {
  handEdit(START);
  const r = await read();
  assert.equal(r.status, 200);
  assert.equal(r.headers.etag, fileVersion());
  assert.match(r.headers.etag, /^"[A-Za-z0-9_-]{43}"$/);
  // The same file is the same version after a restart (a fresh load).
  loadConfig();
  assert.equal((await read()).headers.etag, r.headers.etag);
});

test('a credential changed by hand is a new version, though the read answers the same', async () => {
  handEdit(START);
  const before = await read();
  handEdit(START.replace('hunter2-plaintext', 'rotated-by-hand')); // pragma: allowlist secret
  const after = await read();
  // The masked answer can't show the change, so a version of it would miss it.
  assert.deepEqual(after.body, before.body);
  assert.notEqual(after.headers.etag, before.headers.etag);
  assert.equal(after.headers.etag, fileVersion());
});

test('two tabs: a save based on an older read is refused (409) and the file is unchanged', async () => {
  handEdit(START);
  const tabA = await read();
  const tabB = await read();

  const savedA = await write(withVisible(tabA.body, 'pi1', false), tabA.headers.etag);
  assert.equal(savedA.status, 200, savedA.text);
  const afterA = fileText();

  // Tab B still has the read from before tab A's save.
  const savedB = await write(withVisible(tabB.body, 'nas', false), tabB.headers.etag);
  assert.equal(savedB.status, 409, savedB.text);
  assert.equal(savedB.body.stale, true);
  assert.match(savedB.body.error, /changed since Settings read it/);
  assert.equal(fileText(), afterA, 'the refused save wrote the file');
  assert.equal(yaml.load(fileText()).nodes.pi1.visible, false, "tab A's save is kept");
});

test('a save based on the current read works and answers the next version; so does the next save', async () => {
  handEdit(START);
  const r = await read();
  const first = await write(withVisible(r.body, 'pi1', false), r.headers.etag);
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(first.body, { ok: true });
  assert.notEqual(first.headers.etag, r.headers.etag);
  assert.equal(first.headers.etag, fileVersion(), 'the answer is the version now on disk');

  // The tab saves again with the version the save answered, without a read.
  const edited = withVisible(withVisible(r.body, 'pi1', false), 'nas', false);
  const second = await write(edited, first.headers.etag);
  assert.equal(second.status, 200, second.text);
  assert.equal(second.headers.etag, fileVersion());
  const onDisk = yaml.load(fileText());
  assert.equal(onDisk.nodes.pi1.visible, false);
  assert.equal(onDisk.nodes.nas.visible, false);
  assert.equal(onDisk.integrations.npm.password, 'hunter2-plaintext'); // pragma: allowlist secret
});

test('a save that changes nothing writes nothing and answers the same version', async () => {
  handEdit(START);
  const mtime = statSync(CONFIG_PATH).mtimeMs;
  const r = await read();
  const saved = await write(r.body, r.headers.etag);
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.headers.etag, r.headers.etag);
  assert.equal(fileText(), START);
  assert.equal(statSync(CONFIG_PATH).mtimeMs, mtime);
});

test('a save without If-Match is refused (428) and the file is unchanged', async () => {
  handEdit(START);
  const r = await read();
  const saved = await write(withVisible(r.body, 'pi1', false));
  assert.equal(saved.status, 428, saved.text);
  assert.match(saved.body.error, /reload Settings/);
  assert.equal(fileText(), START);
});

test('a version that is not one is refused (409): *, a made-up one, an empty one', async (t) => {
  for (const version of ['*', '"not-a-version"', '""', 'W/"x"']) {
    await t.test(version, async () => {
      handEdit(START);
      const r = await read();
      const saved = await write(withVisible(r.body, 'pi1', false), version);
      assert.equal(saved.status, 409, saved.text);
      assert.equal(fileText(), START);
    });
  }
});

test('the version a proxy weakened (W/) or listed among others still counts', async (t) => {
  const forms = {
    weak: (tag) => `W/${tag}`,
    'in a list': (tag) => `"other", ${tag}`,
  };
  for (const [name, form] of Object.entries(forms)) {
    await t.test(name, async () => {
      handEdit(START);
      const r = await read();
      const saved = await write(withVisible(r.body, 'pi1', false), form(r.headers.etag));
      assert.equal(saved.status, 200, saved.text);
      assert.equal(yaml.load(fileText()).nodes.pi1.visible, false);
    });
  }
});

test('an integration save between the read and the save makes the save 409', async (t) => {
  const between = {
    'a new integration': () =>
      request(app)
        .post('/api/integrations/save')
        .send({ type: 'adguard', instance: 'second', url: 'http://adguard2.example.test', create: true }),
    'an integration disabled': () =>
      request(app).patch('/api/integrations/npm').send({ enabled: false }),
    'an integration removed': () => request(app).delete('/api/integrations/npm'),
  };
  for (const [name, change] of Object.entries(between)) {
    await t.test(name, async () => {
      handEdit(START);
      const r = await read();
      const other = await change();
      assert.equal(other.status, 200, other.text);
      const afterOther = fileText();
      assert.notEqual(afterOther, START);

      const saved = await write(withVisible(r.body, 'pi1', false), r.headers.etag);
      assert.equal(saved.status, 409, saved.text);
      assert.equal(saved.body.stale, true, 'refused for its version');
      assert.equal(fileText(), afterOther, 'the stale save undid the integration change');
    });
  }
});

test('two saves racing on the same version: exactly one is written, the other is a 409', async () => {
  handEdit(START);
  const r = await read();
  holdPosts(2);
  const [a, b] = await Promise.all([
    write(withVisible(r.body, 'pi1', false), r.headers.etag),
    write(withVisible(r.body, 'nas', false), r.headers.etag),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.text} ${b.text}`);
  const won = a.status === 200 ? 'pi1' : 'nas';
  const lost = won === 'pi1' ? 'nas' : 'pi1';
  const onDisk = yaml.load(fileText());
  assert.equal(onDisk.nodes[won].visible, false);
  assert.notEqual(onDisk.nodes[lost].visible, false, 'the losing save was written too');
  assert.equal((a.status === 200 ? a : b).headers.etag, fileVersion());
});

test('a hand edit after the read makes the save 409, before the watcher has loaded it', async () => {
  handEdit(START);
  const r = await read();
  // On disk only: the watcher polls every 5 s and hasn't seen it yet.
  const edited = START.replace('display_name: NAS', 'display_name: Disks');
  writeFileSync(CONFIG_PATH, edited);

  const saved = await write(withVisible(r.body, 'pi1', false), r.headers.etag);
  assert.equal(saved.status, 409, saved.text);
  assert.equal(fileText(), edited, 'the stale save undid the hand edit');

  // Read again: the answer is the file as it is now, with its version, and a
  // save over that keeps the hand edit.
  const again = await read();
  assert.equal(again.headers.etag, fileVersion());
  assert.equal(again.body.nodes.nas.display_name, 'Disks');
  const retried = await write(withVisible(again.body, 'pi1', false), again.headers.etag);
  assert.equal(retried.status, 200, retried.text);
  const onDisk = yaml.load(fileText());
  assert.equal(onDisk.nodes.nas.display_name, 'Disks');
  assert.equal(onDisk.nodes.pi1.visible, false);
  assert.equal(getConfig().nodes.nas.display_name, 'Disks');
});

test('an integration save starts from the file, so a hand edit the watcher has not loaded is kept', async () => {
  handEdit(START);
  const edited = START.replace('display_name: NAS', 'display_name: Disks');
  writeFileSync(CONFIG_PATH, edited);

  const r = await request(app).patch('/api/integrations/npm').send({ enabled: false });
  assert.equal(r.status, 200, r.text);
  const onDisk = yaml.load(fileText());
  assert.equal(onDisk.nodes.nas.display_name, 'Disks', 'the integration save undid the hand edit');
  assert.equal(onDisk.integrations.npm.enabled, false);
});
