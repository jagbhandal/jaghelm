/**
 * #566: a first boot that finds no node saves no services.yaml, and asks
 * again each refresh until Prometheus has nodes.
 *
 * The first boot used to save the default config whatever discovery
 * answered: with Prometheus down, or up but not scraped yet, that was a file
 * with no nodes, and since the file was there discovery never ran again. Now
 * nothing is written until discovery finds a node; the services refresh asks
 * again each cycle and saves the default with the nodes once there are some.
 * Any file on disk is the user's: one saved in Settings, or put there by
 * hand, ends the wait and is never discovered over, even one that lands
 * between discovery's look and its write.
 *
 * Its own file because the modules' state is the point (the config in
 * memory, the wait): each test starts a first boot afresh, as index.js does
 * (no file, loadConfig(), firstBoot()), and drives the real services refresh
 * against a mock Prometheus.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const { createMockPrometheus, homelabSeries } = await import('./testing/mockPrometheus.js');
const { initDiscovery, discoverNodes } = await import('./discovery.js');
const {
  CONFIG_ABSENT,
  configHealth,
  configProblem,
  getConfig,
  loadConfig,
  readConfig,
  startConfigWatcher,
  stopConfigWatcher,
  writeConfig,
} = await import('./config.js');
const { askAgain, configHealthNow, firstBoot, waitingForNodes } = await import('./firstBoot.js');
const { getCached } = await import('./cache.js');
const { refreshServices, stopBackgroundRefresh } = await import('./refresh.js');
const { servicesRoutes } = await import('./routes/services.js');
const { systemRoutes } = await import('./routes/system.js');
const { initSecrets, setSecret, getSecretOrigins, unboundSecretNames } = await import('./secrets.js');
const { bindSecretsAtBoot } = await import('./integrations/secretBinding.js');

initSecrets();

const DATA = process.env.JAGHELM_DATA_DIR;
const CONFIG_PATH = join(DATA, 'services.yaml');
const SECRETS_PATH = join(DATA, 'secrets.json');

const app = express();
app.use(express.json());
app.use('/api/services', servicesRoutes);
app.use('/api', systemRoutes);

// ── A Prometheus that is down, up with no nodes, or up with two ──

const PROM = 'http://localhost:9995';
const { labels, series: HOMELAB } = homelabSeries({ nodes: 2 });
// What discovery finds in it: the two nodes and `elsewhere`, never asked for.
const FOUND = [...labels, 'elsewhere'].sort();
const mock = createMockPrometheus([], { url: PROM });
// `down` refuses every request; `gate`, while set, holds each one until it
// settles, and `entered` is called as one starts waiting on it.
const world = { down: true, gate: null, entered: null };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith(PROM)) throw new Error(`unexpected fetch ${url}`);
  if (world.gate) {
    world.entered?.();
    await world.gate;
  }
  if (world.down) throw new TypeError('fetch failed');
  return mock.fetch(url, init);
};

/** Prometheus down, up with no node scraped yet, or up with the homelab's. */
function prometheus(state) {
  world.down = state === 'down';
  mock.series = state === 'nodes' ? HOMELAB : [];
}

// Every link(2) goes through here, so a test can put a file in place at the
// last moment before the write's own link: what a hand edit racing it does.
const realLink = fs.linkSync;
let beforeLink = null;
fs.linkSync = function linkSync(from, to, ...rest) {
  if (to === CONFIG_PATH && beforeLink) {
    const run = beforeLink;
    beforeLink = null;
    run();
  }
  return realLink(from, to, ...rest);
};
syncBuiltinESMExports();

after(() => {
  stopConfigWatcher();
  stopBackgroundRefresh();
  globalThis.fetch = realFetch;
  fs.linkSync = realLink;
  syncBuiltinESMExports();
});

/** The structured logger's lines (parsed) written while `fn` runs. */
async function captureLogs(fn) {
  const lines = [];
  const orig = { out: process.stdout.write, err: process.stderr.write };
  const tap = (write) =>
    function (chunk, ...rest) {
      try {
        const obj = JSON.parse(String(chunk));
        if (obj?.module && obj.level) {
          lines.push(obj);
          return true;
        }
      } catch {
        // not a log line
      }
      return write.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(orig.out);
  process.stderr.write = tap(orig.err);
  try {
    await fn();
  } finally {
    process.stdout.write = orig.out;
    process.stderr.write = orig.err;
  }
  return lines;
}

const firstBootLines = (lines) => lines.filter((l) => /^first boot/.test(l.msg)).map((l) => l.msg);

/** A first boot as index.js runs it, with Prometheus `state` and no file. */
async function boot(state, { problem = null } = {}) {
  fs.rmSync(CONFIG_PATH, { force: true });
  initDiscovery(PROM, { problem });
  prometheus(state);
  assert.equal(loadConfig(), null, 'no file: a first boot');
  return firstBoot();
}

const exists = () => fs.existsSync(CONFIG_PATH);
const fileText = () => fs.readFileSync(CONFIG_PATH, 'utf8');
const nodesOf = (cfg) => Object.keys(cfg?.nodes ?? {}).sort();
const servedNodes = () => Object.keys(getCached('services')?.nodes ?? {}).sort();

/** Settings' read of the config, then its save of `change(config)` over that version. */
async function settingsSave(change) {
  const read = await request(app).get('/api/services/config');
  assert.equal(read.status, 200, JSON.stringify(read.body));
  const saved = await request(app)
    .post('/api/services/config')
    .set('If-Match', read.headers.etag)
    .send(change(read.body));
  return { read, saved };
}

// A user's own file, with no nodes, written by hand.
const USERS = '# mine\nnodes: {}\nservices: {}\nintegrations: {}\n';

test('first boot with Prometheus down, then up: nothing saved while down; the nodes appear without a restart and the file is written then', async () => {
  const cfg = await boot('down');
  assert.equal(exists(), false, 'nothing saved');
  assert.deepEqual(cfg, { nodes: {}, services: {}, integrations: {} }, 'the default in memory');
  assert.equal(waitingForNodes(), true);

  for (let i = 0; i < 3; i += 1) {
    await refreshServices();
    assert.equal(exists(), false, `cycle ${i}: still nothing saved`);
  }
  // The board says Prometheus failed (#449), and that discovery waits.
  assert.deepEqual(getCached('services'), {
    nodes: {},
    overallHealth: 'unknown',
    sources: { prometheus: { ok: false } },
    discovery: 'waiting',
  });

  prometheus('nodes');
  await refreshServices();
  assert.equal(exists(), true, 'written once Prometheus has nodes');
  assert.deepEqual(nodesOf(loadConfig()), FOUND);
  assert.deepEqual(servedNodes(), FOUND, 'read in the same cycle');
  assert.equal(getCached('services').discovery, undefined);
  assert.equal(waitingForNodes(), false);

  // Once: later cycles write nothing, even with other nodes in Prometheus.
  const text = fileText();
  mock.series = homelabSeries({ nodes: 4 }).series;
  await refreshServices();
  assert.equal(fileText(), text);
});

test('first boot with Prometheus up but no node scraped yet, then nodes: the same', async () => {
  await boot('empty');
  assert.equal(exists(), false);
  await refreshServices();
  assert.equal(exists(), false);
  assert.deepEqual(getCached('services'), {
    nodes: {},
    overallHealth: 'unknown',
    sources: { prometheus: { ok: true } },
    discovery: 'waiting',
  });

  prometheus('nodes');
  await refreshServices();
  assert.deepEqual(nodesOf(loadConfig()), FOUND);
  assert.deepEqual(servedNodes(), FOUND);
});

test('first boot with Prometheus up and nodes: saved at boot, as before', async () => {
  const cfg = await boot('nodes');
  assert.deepEqual(nodesOf(cfg), FOUND);
  assert.deepEqual(nodesOf(loadConfig()), FOUND);
  assert.equal(waitingForNodes(), false);
});

test('one log line when the wait starts and one when it ends, none per cycle', async () => {
  const lines = await captureLogs(async () => {
    await boot('down');
    for (let i = 0; i < 4; i += 1) await refreshServices();
    prometheus('nodes');
    await refreshServices();
    await refreshServices();
  });
  assert.deepEqual(firstBootLines(lines), [
    'first boot — running node discovery',
    'first boot: node discovery could not reach Prometheus; nothing saved, asking again each refresh until it has nodes',
    'first boot: Prometheus has nodes now, saved services.yaml with them',
  ]);
  const found = lines.find((l) => /has nodes now/.test(l.msg));
  assert.deepEqual([...found.nodes].sort(), FOUND);

  const empty = await captureLogs(() => boot('empty'));
  assert.deepEqual(firstBootLines(empty), [
    'first boot — running node discovery',
    'first boot: Prometheus has no nodes yet; nothing saved, asking again each refresh until it has some',
  ]);
});

test('a file the user saved with no nodes is never discovered over', async () => {
  fs.writeFileSync(CONFIG_PATH, USERS);
  prometheus('nodes');
  // A file is there: no first boot.
  assert.deepEqual(nodesOf(loadConfig()), []);
  assert.equal(waitingForNodes(), false);
  for (let i = 0; i < 3; i += 1) await refreshServices();
  assert.equal(fileText(), USERS);
  assert.deepEqual(servedNodes(), []);
  assert.equal(getCached('services').discovery, undefined, 'Settings says nothing is discovering');
});

test('a Settings save while discovery waits writes the file and ends the wait; its file stands', async () => {
  await boot('down');
  // A save that changes nothing writes nothing, and the wait goes on.
  const same = await settingsSave((body) => body);
  assert.equal(same.read.headers.etag, `"${CONFIG_ABSENT}"`, 'no file: its version is the absent one');
  assert.deepEqual(same.read.body, { nodes: {}, services: {}, integrations: {} });
  assert.equal(same.saved.status, 200);
  assert.equal(exists(), false);
  assert.equal(waitingForNodes(), true);

  // A save that changes something, over the absent version (#423).
  const { saved } = await settingsSave((body) => ({ ...body, services: { web: { display_name: 'Web' } } }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.ok(saved.headers.etag && saved.headers.etag !== `"${CONFIG_ABSENT}"`);
  const text = fileText();
  assert.equal(waitingForNodes(), false, 'the file ends the wait');

  prometheus('nodes');
  for (let i = 0; i < 2; i += 1) await refreshServices();
  assert.equal(fileText(), text, 'never discovered over');
  assert.deepEqual(servedNodes(), []);
});

test('a file put there by hand while discovery waits is loaded and ends the wait', async () => {
  await boot('down');
  const HAND = 'nodes:\n  mine:\n    display_name: Mine\nservices: {}\n';
  fs.writeFileSync(CONFIG_PATH, HAND);
  prometheus('nodes');
  await refreshServices();
  assert.equal(fileText(), HAND);
  assert.deepEqual(nodesOf(getConfig()), ['mine'], 'loaded at once, before the watcher looks');
  assert.equal(waitingForNodes(), false);
});

test('a file that lands between discovery\'s look and its write stands: the write only creates', async () => {
  await boot('down');
  prometheus('nodes');
  // The user's file appears after discovery saw no file, before its link.
  beforeLink = () => fs.writeFileSync(CONFIG_PATH, USERS);
  const lines = await captureLogs(() => refreshServices());
  assert.equal(beforeLink, null, 'the race ran');
  assert.equal(fileText(), USERS, "the user's file is untouched");
  assert.deepEqual(nodesOf(getConfig()), [], "and is the config now, not discovery's");
  assert.equal(waitingForNodes(), false);
  assert.ok(
    lines.some((l) => l.msg === 'first boot: Prometheus has nodes now, but services.yaml was written meanwhile; it stays as it is'),
    JSON.stringify(lines.map((l) => l.msg))
  );
  assert.equal(fs.readdirSync(DATA).filter((f) => f.startsWith('services.yaml.tmp')).length, 0, 'no temp file left');

  // writeConfig itself: a write over CONFIG_ABSENT never replaces a file.
  fs.rmSync(CONFIG_PATH);
  readConfig();
  beforeLink = () => fs.writeFileSync(CONFIG_PATH, USERS);
  const saved = writeConfig({ nodes: { x: {} } }, CONFIG_ABSENT);
  assert.equal(saved.ok, false);
  assert.equal(saved.conflict, true);
  assert.equal(fileText(), USERS);
});

test('a Settings save while discovery is asking stands: discovery saves nothing over it', async () => {
  await boot('down');
  prometheus('nodes');
  let release;
  let entered;
  world.gate = new Promise((resolve) => {
    release = resolve;
  });
  const asking = new Promise((resolve) => {
    entered = resolve;
  });
  world.entered = entered;
  const cycle = refreshServices();
  await asking;
  // Discovery's query is out; the save lands meanwhile.
  world.gate = null;
  world.entered = null;
  const { saved } = await settingsSave((body) => ({ ...body, services: { web: { display_name: 'Web' } } }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const text = fileText();
  release();
  await cycle;
  assert.equal(fileText(), text);
  assert.deepEqual(nodesOf(loadConfig()), []);
  assert.equal(waitingForNodes(), false);
});

test('while waiting the config is no down source: health says discovering, the watcher and the #536 retry see nothing wrong', async (t) => {
  await boot('down');
  assert.equal(configProblem(), null, 'the status model sees no config problem');
  assert.deepEqual(configHealth(), { state: 'ok' });
  assert.deepEqual(configHealthNow(), { state: 'discovering' });
  const read = readConfig();
  assert.deepEqual(read, { config: { nodes: {}, services: {}, integrations: {} }, version: CONFIG_ABSENT });

  const health = await request(app).get('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.deepEqual(health.body.config, { state: 'discovering' });

  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const lines = await captureLogs(() => {
    startConfigWatcher();
    // Many polls and many retry periods: no reload, no retry read.
    for (let i = 0; i < 24; i += 1) t.mock.timers.tick(5_000);
  });
  stopConfigWatcher();
  assert.deepEqual(lines.filter((l) => /reloading services\.yaml/.test(l.msg)), []);
  assert.equal(configProblem(), null);
  assert.deepEqual(configHealthNow(), { state: 'discovering' });

  // Once a file is there, health says what it says about any file.
  fs.writeFileSync(CONFIG_PATH, USERS);
  assert.deepEqual((await request(app).get('/api/health')).body.config, { state: 'ok' });
});

test('a refused PROMETHEUS_URL: one line, no wait; neither health nor Settings says discovery is under way', async () => {
  const problem = 'PROMETHEUS_URL has a user or password in it; it is not used';
  let cfg;
  const asked = mock.queries.length;
  const lines = await captureLogs(async () => {
    cfg = await boot('nodes', { problem });
    for (let i = 0; i < 3; i += 1) await refreshServices();
  });
  assert.deepEqual(firstBootLines(lines), [
    'first boot: PROMETHEUS_URL is refused, so no node discovery and nothing saved; fix it and restart',
  ]);
  assert.deepEqual(cfg, { nodes: {}, services: {}, integrations: {} });
  assert.equal(exists(), false, 'nothing saved: a restart with the URL fixed is a first boot again');
  assert.equal(waitingForNodes(), false);
  assert.equal(await askAgain(), null);
  assert.deepEqual(getCached('services'), {
    nodes: {},
    overallHealth: 'unknown',
    sources: { prometheus: { ok: false } },
  });
  assert.deepEqual(configHealthNow(), { state: 'ok' });
  assert.equal(mock.queries.length, asked, 'never asked');
  // Discovery itself rejects with the problem rather than answering no nodes.
  await assert.rejects(discoverNodes(), { message: problem });
});

test('services.yaml a dangling symlink: a write is an error, not a conflict; the first boot runs on the nodes it found', async () => {
  const target = join(DATA, 'gone', 'services.yaml');
  const dangle = () => {
    fs.rmSync(CONFIG_PATH, { force: true });
    fs.symlinkSync(target, CONFIG_PATH);
  };
  try {
    // At boot: it reads as no file, so this is a first boot; the link
    // refuses the save, and the nodes found stay in memory.
    dangle();
    initDiscovery(PROM);
    prometheus('nodes');
    assert.equal(loadConfig(), null);
    let cfg;
    const lines = await captureLogs(async () => {
      cfg = await firstBoot();
    });
    assert.deepEqual(nodesOf(cfg), FOUND, 'never null: the boot logs its nodes from it');
    assert.deepEqual(nodesOf(getConfig()), FOUND);
    assert.equal(waitingForNodes(), false);
    assert.deepEqual(firstBootLines(lines).slice(1), [
      'first boot: discovered nodes; running on them, services.yaml not saved (the next save writes it)',
    ]);
    assert.ok(
      lines.some((l) => l.level === 'error' && /symlink to a file that doesn't exist/.test(l.msg)),
      JSON.stringify(lines.map((l) => l.msg))
    );
    assert.ok(!lines.some((l) => /meanwhile/.test(l.msg)), 'no file was written meanwhile');
    assert.ok(fs.lstatSync(CONFIG_PATH).isSymbolicLink(), 'the link is left as it is');
    assert.equal(fs.existsSync(target), false);

    // The same once the wait is on: Prometheus has nodes later.
    dangle();
    prometheus('down');
    assert.equal(loadConfig(), null);
    await firstBoot();
    assert.equal(waitingForNodes(), true, 'a link to nothing reads as no file');
    prometheus('nodes');
    await refreshServices();
    assert.deepEqual(servedNodes(), FOUND, 'on the board all the same');
    assert.equal(waitingForNodes(), false);

    // writeConfig and a Settings save: an error (500), never a 409 to retry forever.
    const saved = writeConfig({ nodes: {} }, CONFIG_ABSENT);
    assert.deepEqual(saved, { ok: false });
    const read = await request(app).get('/api/services/config');
    assert.equal(read.headers.etag, `"${CONFIG_ABSENT}"`);
    const post = await request(app)
      .post('/api/services/config')
      .set('If-Match', read.headers.etag)
      .send({ ...read.body, services: { web: { display_name: 'Web' } } });
    assert.equal(post.status, 500, JSON.stringify(post.body));
    assert.ok(fs.lstatSync(CONFIG_PATH).isSymbolicLink());
  } finally {
    fs.rmSync(CONFIG_PATH, { force: true });
  }
});

test('discovery rejects when Prometheus is down and answers [] when it has no nodes', async () => {
  initDiscovery(PROM);
  prometheus('down');
  await assert.rejects(discoverNodes(), /fetch failed/);
  prometheus('empty');
  assert.deepEqual(await discoverNodes(), []);
  prometheus('nodes');
  assert.deepEqual((await discoverNodes()).sort(), FOUND);
});

test('stored secrets are never bound to the default discovery writes; the first good load from disk binds them (#556)', async (t) => {
  // A secret stored before #556: no origins.
  setSecret('boot_key', 'x'); // pragma: allowlist secret
  const store = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
  delete store.boot_key.origins;
  fs.writeFileSync(SECRETS_PATH, JSON.stringify(store));
  initSecrets();

  fs.rmSync(CONFIG_PATH, { force: true });
  assert.equal(loadConfig(), null);
  assert.equal(bindSecretsAtBoot(), null, 'no file at boot: it waits');
  initDiscovery(PROM);
  prometheus('down');
  await firstBoot();
  prometheus('nodes');
  await refreshServices();
  assert.deepEqual(nodesOf(readConfig().config), FOUND, 'discovery wrote its default');

  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  startConfigWatcher();
  t.mock.timers.tick(5_250);
  assert.ok(unboundSecretNames().includes('boot_key'), 'its own write is no load from disk');

  // The user's file, by hand: the watcher loads it and the secret is bound to its entry.
  fs.writeFileSync(
    CONFIG_PATH,
    [
      'integrations:',
      '  statuspage:',
      '    url: "http://status.example.test"',
      '    endpoint: /api/summary',
      '    auth: header',
      '    authHeader: X-Api-Key',
      '    token: $secret:boot_key', // pragma: allowlist secret
      '',
    ].join('\n')
  );
  t.mock.timers.tick(5_000);
  t.mock.timers.tick(250);
  stopConfigWatcher();
  assert.ok(!unboundSecretNames().includes('boot_key'));
  assert.deepEqual(getSecretOrigins('boot_key'), ['http://status.example.test:80']);
});
