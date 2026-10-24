/**
 * #572: Settings → Nodes "Find nodes". POST /api/services/nodes/find asks
 * Prometheus now (the first boot's discovery, discoverNodes) and answers the
 * nodes the file doesn't have, shaped as a first boot would write them. It
 * writes nothing: Settings adds them with its ordinary save over the version
 * it read.
 *
 * These drive the real route against the real config module and file, and a
 * mock Prometheus behind fetch.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const { createMockPrometheus } = await import('../testing/mockPrometheus.js');
const { initDiscovery } = await import('../discovery.js');
const { loadConfig, getConfig, useUnsavedConfig } = await import('../config.js');
const { servicesRoutes } = await import('./services.js');

const PROM = 'http://localhost:9994';
const mock = createMockPrometheus([], { url: PROM });
const world = { down: false };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith(PROM)) throw new Error(`unexpected fetch ${url}`);
  if (world.down) throw new TypeError('fetch failed');
  return mock.fetch(url, init);
};
after(() => {
  globalThis.fetch = realFetch;
});
initDiscovery(PROM);

const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');
const app = express();
app.disable('etag');
app.set('trust proxy', true); // each test asks from its own address, so the rate limit is its own
app.use(express.json({ limit: '1mb' }));
app.use('/api/services', servicesRoutes);

const up = (node) => ({ labels: { __name__: 'up', job: `ne-${node}`, node, instance: `${node}:9100` }, value: 1 });
/** Prometheus up with these node labels. */
function prometheusHas(...nodes) {
  world.down = false;
  mock.series = nodes.map(up);
}
const FILE = `# mine
nodes:
  pi1:
    prometheus_node: pi1
    display_name: Gateway
    subtitle: Pi 5
    border_color: '#ff0000'
    visible: true
    auto_discover: false
    hide: [prometheus, mine]
services: {}
integrations: {}
`;
function useFile(text) {
  writeFileSync(CONFIG_PATH, text);
  loadConfig();
}
let nextIp = 1;
const find = (ip = `10.0.0.${nextIp++}`) => request(app).post('/api/services/nodes/find').set('X-Forwarded-For', ip).send({});

test('a file with no nodes gets Prometheus\'s nodes: they come back shaped as a first boot writes them, and nothing is written', async () => {
  useFile('nodes: {}\nservices: {}\nintegrations: {}\n');
  prometheusHas('pi1', 'vm103');
  const before = readFileSync(CONFIG_PATH, 'utf8');
  const res = await find();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body.nodes).sort(), ['pi1', 'vm103']);
  assert.deepEqual(res.body.nodes.vm103, {
    prometheus_node: 'vm103',
    display_name: 'vm103',
    subtitle: '',
    border_color: '#6366f1',
    visible: true,
    auto_discover: true,
    hide: ['prometheus', 'node-exporter', 'cadvisor'],
  });
  assert.equal(readFileSync(CONFIG_PATH, 'utf8'), before, 'a look writes nothing');
});

test('adding them over the version Settings read leaves the file with the nodes; a moved file is a 409', async () => {
  useFile('nodes: {}\nservices: {}\nintegrations: {}\n');
  prometheusHas('pi1');
  const read = await request(app).get('/api/services/config');
  const { nodes } = (await find()).body;
  const saved = await request(app)
    .post('/api/services/config')
    .set('If-Match', read.headers.etag)
    .send({ ...read.body, nodes });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(Object.keys(getConfig().nodes), ['pi1']);
  // The same version again, after the file moved: refused.
  const again = await request(app)
    .post('/api/services/config')
    .set('If-Match', read.headers.etag)
    .send({ ...read.body, nodes });
  assert.equal(again.status, 409);
});

test('existing nodes and their settings are untouched: only nodes the file lacks come back', async () => {
  useFile(FILE);
  prometheusHas('pi1', 'pi2');
  const res = await find();
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.nodes), ['pi2']);
  assert.equal(readFileSync(CONFIG_PATH, 'utf8'), FILE);
});

test('a node under another key counts as present by its prometheus_node, and a hidden node counts too', async () => {
  useFile(`nodes:
  gateway:
    prometheus_node: pi1
    display_name: Gateway
  quiet:
    visible: false
  nas:
    visible: false
    prometheus_node: nas01
services: {}
integrations: {}
`);
  prometheusHas('pi1', 'quiet', 'nas01', 'vm101');
  const res = await find();
  assert.deepEqual(Object.keys(res.body.nodes), ['vm101']);
});

test('nothing new: an empty list', async () => {
  useFile(FILE);
  prometheusHas('pi1');
  const res = await find();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.nodes, {});
});

test('the instance label (no node label scraped) gives the host as the key, never a colon; prometheus_node keeps the real label', async () => {
  useFile('nodes: {}\nservices: {}\nintegrations: {}\n');
  world.down = false;
  mock.series = [{ labels: { __name__: 'up', job: 'node', instance: 'pi9:9100' }, value: 1 }];
  const res = await find();
  assert.deepEqual(Object.keys(res.body.nodes), ['pi9']);
  assert.equal(res.body.nodes.pi9.prometheus_node, 'pi9:9100');
});

test('two instances on one host get distinct keys: -2 for the second, deterministic', async () => {
  useFile('nodes: {}\nservices: {}\nintegrations: {}\n');
  world.down = false;
  mock.series = ['pi9:9100', 'pi9:9101'].map((instance) => ({ labels: { __name__: 'up', job: 'node', instance }, value: 1 }));
  const res = await find();
  assert.deepEqual(Object.keys(res.body.nodes), ['pi9', 'pi9-2']);
  assert.deepEqual(Object.values(res.body.nodes).map((n) => n.prometheus_node), ['pi9:9100', 'pi9:9101']);
});

test('a host key already in the file for another node is not taken: the new one is suffixed', async () => {
  useFile('nodes:\n  pi9:\n    prometheus_node: other\nservices: {}\nintegrations: {}\n');
  world.down = false;
  mock.series = [{ labels: { __name__: 'up', job: 'node', instance: 'pi9:9100' }, value: 1 }];
  assert.deepEqual(Object.keys((await find()).body.nodes), ['pi9-2']);
});

test('a node already keyed by the raw instance label, by its host, or mapped to it counts as present', async () => {
  world.down = false;
  mock.series = [{ labels: { __name__: 'up', job: 'node', instance: 'pi9:9100' }, value: 1 }];
  for (const nodes of [
    '  "pi9:9100": {}\n',
    '  pi9: {}\n',
    '  pi9:\n    prometheus_node: pi9:9100\n',
    '  other:\n    visible: false\n    prometheus_node: pi9:9100\n',
  ]) {
    useFile(`nodes:\n${nodes}services: {}\nintegrations: {}\n`);
    assert.deepEqual((await find()).body.nodes, {}, nodes);
  }
});

test('with no Prometheus set up it says so, distinct from none new, and writes nothing', async () => {
  useFile(FILE);
  initDiscovery(undefined);
  try {
    const res = await find();
    assert.equal(res.status, 502);
    assert.equal(res.body.code, 'prometheus_unset');
    assert.equal(res.body.error, 'No Prometheus is set up');
  } finally {
    initDiscovery(PROM);
  }
  assert.equal(readFileSync(CONFIG_PATH, 'utf8'), FILE);
});

test('a save adding a node key with a colon is refused; one the file already has still saves', async () => {
  useFile('nodes:\n  "old:1": {}\nservices: {}\nintegrations: {}\n');
  const read = await request(app).get('/api/services/config');
  const refused = await request(app)
    .post('/api/services/config')
    .set('If-Match', read.headers.etag)
    .send({ ...read.body, nodes: { 'old:1': {}, 'new:2': {} } });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /new:2/);
  const kept = await request(app)
    .post('/api/services/config')
    .set('If-Match', read.headers.etag)
    .send({ ...read.body, nodes: { 'old:1': { display_name: 'x' } } });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
});

test('Prometheus unreachable: said in words, nothing written', async () => {
  useFile(FILE);
  world.down = true;
  const res = await find();
  assert.equal(res.status, 502);
  assert.match(res.body.error, /^Prometheus /);
  assert.doesNotMatch(res.body.error, /fetch failed|localhost|9994/);
  assert.equal(readFileSync(CONFIG_PATH, 'utf8'), FILE);
});

test('a services.yaml that doesn\'t parse is the 503 the other routes give', async () => {
  writeFileSync(CONFIG_PATH, 'nodes: [unclosed\n');
  loadConfig();
  prometheusHas('pi1');
  const res = await find();
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'config_unparseable');
});

test('no file yet (a first boot still waiting): measured against the config the board runs on, in memory', async () => {
  rmSync(CONFIG_PATH, { force: true });
  useUnsavedConfig({ nodes: {}, services: {}, integrations: {} });
  prometheusHas('pi1');
  const res = await find();
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.nodes), ['pi1']);
});

test('rate limited: the 11th ask in a minute is a 429, and Prometheus is not asked', async () => {
  useFile(FILE);
  prometheusHas('pi1');
  let last;
  for (let i = 0; i < 12; i += 1) last = await find('10.9.9.9');
  assert.equal(last.status, 429);
});
