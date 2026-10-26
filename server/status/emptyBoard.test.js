/**
 * When the board is empty (#449): `empty` only when nothing is set up and
 * every read that ran answered. A board with nothing on it for any other
 * reason (a Prometheus that doesn't answer, a source that is set up, a
 * refresh that left nothing) is not calm, so it is never `empty`.
 *
 * These drive the real refreshes (refresh.js runCycleRefreshes: services,
 * UPS, Gitea, integrations) with services.yaml holding no nodes, against a
 * stubbed fetch, into the real cache, then read the status model from it as
 * the loop does (readStatusInputs, buildStatus). So the services payload is
 * the one the live refresh builds with no nodes, never a hand-written copy.
 *
 * Tests share the cache and run in order; each runs its own refresh cycle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { initDiscovery } = await import('../discovery.js');
const { saveConfig } = await import('../config.js');
const { getCached, getCachedInternal } = await import('../cache.js');
const { runCycleRefreshes } = await import('../refresh.js');
const { _resetGiteaPoll } = await import('../gitea.js');
const { buildStatus, readStatusInputs, DEFAULT_THRESHOLDS } = await import('./index.js');

const PROM = 'http://localhost:9996';
const GITEA = 'http://localhost:9997';
initDiscovery(PROM);
saveConfig({ nodes: {}, services: {} });

// What each upstream does this cycle.
const world = { prometheus: 'ok', gitea: 'ok' };

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  body: null,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith(PROM)) {
    if (world.prometheus === 'refused') throw new TypeError('fetch failed');
    // No UPS, nothing scraped: every query answers, with no series.
    return json(200, { status: 'success', data: { resultType: 'vector', result: [] } });
  }
  if (u.startsWith(GITEA)) {
    if (world.gitea === 'refused') throw new TypeError('fetch failed');
    return json(200, { ok: true, data: [] });
  }
  throw new Error(`unexpected fetch ${u}`);
};
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

const NOW = 1_782_345_600_000;

/**
 * One background cycle with `world` as given, then the status the loop would
 * build from it. `env` is what KUMA_URL and GITEA_URL are read from; `hide`
 * leaves a cache out, as a refresh that threw leaves nothing cached. Each one
 * polls Gitea: the 5-minute wait between polls (gitea.js) is not under test.
 */
async function cycle({ prometheus = 'ok', gitea = 'ok', env = {}, hide = [] } = {}) {
  Object.assign(world, { prometheus, gitea });
  const saved = process.env.GITEA_URL;
  if (env.GITEA_URL) process.env.GITEA_URL = env.GITEA_URL;
  else delete process.env.GITEA_URL;
  let cycleErrors;
  try {
    _resetGiteaPoll();
    cycleErrors = await runCycleRefreshes();
  } finally {
    if (saved === undefined) delete process.env.GITEA_URL;
    else process.env.GITEA_URL = saved;
  }
  const caches = {
    getCached: (key) => (hide.includes(key) ? null : getCached(key)),
    getCachedInternal: (key) => (hide.includes(key) ? null : getCachedInternal(key)),
    getAllCronStatuses: () => [],
  };
  const { status } = buildStatus({
    inputs: readStatusInputs(caches, { env: { PROMETHEUS_URL: 'http://prom', ...env }, cycleErrors }),
    thresholds: DEFAULT_THRESHOLDS,
    now: NOW,
  });
  return { status, cycleErrors };
}

const NOTHING = 'Nothing monitored yet';

test('a true first run is empty: no nodes, Prometheus answers, nothing else set up', async () => {
  const { status, cycleErrors } = await cycle();
  assert.deepEqual(cycleErrors, []);
  // The live refresh's payload with no nodes says whether Prometheus answered.
  assert.deepEqual(getCached('services'), {
    nodes: {},
    overallHealth: 'unknown',
    sources: { prometheus: { ok: true } },
  });
  assert.deepEqual(status.overall, { state: 'empty', sentence: NOTHING });
  assert.deepEqual(status.entities, []);
  assert.deepEqual(status.issues, []);
  assert.deepEqual(status.sources, { prometheus: { state: 'ok', since: NOW } });
});

test('first boot with Prometheus unreachable is a failed source, never empty', async () => {
  // A wrong PROMETHEUS_URL, with a services.yaml that has no nodes (the
  // user's: a first boot saves none until discovery finds a node, #566), and
  // every query fails.
  const { status } = await cycle({ prometheus: 'refused' });
  assert.deepEqual(getCached('services').sources, { prometheus: { ok: false } });
  assert.equal(getCached('ups').ok, false, 'the UPS read failed with it');
  assert.notEqual(status.overall.state, 'empty');
  assert.deepEqual(status.overall, { state: 'warn', sentence: 'Prometheus unreachable' });
  assert.equal(status.sources.prometheus.state, 'failed');
  // In words (#605): a bare "fetch failed" has no cause to read.
  assert.equal(status.sources.prometheus.error, "Prometheus didn't answer");
  assert.deepEqual(
    status.issues.map((i) => i.id),
    ['sources/prometheus']
  );
});

test('KUMA_URL set with no nodes is something set up: unknown, not empty', async () => {
  const { status } = await cycle({ env: { KUMA_URL: 'http://localhost:9999' } });
  assert.deepEqual(Object.keys(status.sources).sort(), ['kuma', 'prometheus']);
  assert.deepEqual(status.overall, { state: 'unknown', sentence: NOTHING });
});

test('GITEA_URL set while Gitea fails: unknown, not empty', async () => {
  const { status, cycleErrors } = await cycle({ gitea: 'refused', env: { GITEA_URL: GITEA } });
  assert.deepEqual(cycleErrors, ['gitea']);
  assert.equal(status.sources.gitea.state, 'failed');
  assert.deepEqual(status.overall, { state: 'unknown', sentence: NOTHING });
});

test('GITEA_URL set and Gitea answering is still something set up: unknown, not empty', async () => {
  const { status, cycleErrors } = await cycle({ env: { GITEA_URL: GITEA } });
  assert.deepEqual(cycleErrors, []);
  assert.equal(status.sources.gitea.state, 'ok');
  assert.deepEqual(status.overall, { state: 'unknown', sentence: NOTHING });
});

test('nodes in services.yaml but the services refresh left nothing cached: unknown, not empty', async () => {
  saveConfig({ nodes: { vm103: { display_name: 'vm103' } }, services: {} });
  try {
    // The refresh threw (it logs and caches nothing), or its entry expired.
    const { status } = await cycle({ hide: ['services'] });
    assert.deepEqual(status.entities, []);
    assert.deepEqual(status.overall, { state: 'unknown', sentence: NOTHING });
  } finally {
    saveConfig({ nodes: {}, services: {} });
  }
});

test('the UPS or the integrations refresh left nothing cached: not empty', async () => {
  // The UPS is read through Prometheus, so a missing UPS read fails it.
  const noUps = await cycle({ hide: ['ups'] });
  assert.deepEqual(noUps.status.overall, { state: 'warn', sentence: 'Prometheus unreachable' });
  assert.equal(noUps.status.sources.prometheus.error, 'The UPS query failed');
  const noIntegrations = await cycle({ hide: ['integrations'] });
  assert.deepEqual(noIntegrations.status.overall, { state: 'unknown', sentence: NOTHING });
  // And with every read answering again, it is empty again.
  const { status } = await cycle();
  assert.equal(status.overall.state, 'empty');
});
