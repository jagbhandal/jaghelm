/**
 * Contract tests for the endpoints older Android apps read (spec §6.3, #292):
 * /api/services, /api/ups and /api/cron/status keep their shape and meaning
 * until one release after Phase 4 (P4-4). The status model's new states
 * (maintenance, pending, unknown because a source failed) appear only in
 * /api/status; the old endpoints keep today's values for the same cycle.
 *
 * The real app, the real refreshes against a stubbed Prometheus and Kuma (its
 * public status page), the real loop step that builds the status
 * (refresh.js updateStatus), and supertest. Each test states the cycle it
 * runs. Key lists are frozen as main served them when /api/status was added.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-contract-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234';
process.env.JAGHELM_CRON_SECRET = 'cron-s3cret';
const PROM = 'http://localhost:9997';
const KUMA = 'http://localhost:9996';
process.env.PROMETHEUS_URL = PROM;
process.env.KUMA_URL = KUMA;

const { app } = await import('../index.js');
const { initDiscovery } = await import('../discovery.js');
const { initMonitors } = await import('../monitors.js');
const { saveConfig } = await import('../config.js');
const { getCached } = await import('../cache.js');
const { refreshServices, refreshUPS, stopBackgroundRefresh, updateStatus } =
  await import('../refresh.js');
const { createSession } = await import('../auth/sessions.js');

initDiscovery(PROM);
initMonitors(KUMA);
saveConfig({
  nodes: { vm103: { display_name: 'VM 103' }, pi: { display_name: 'Pi' } },
  services: {},
});
const token = createSession('admin');

// ── The stubbed homelab ──────────────────────────────────────────────────

const GiB = 1073741824;
const EVAL = Math.floor(Date.now() / 1000);
const CONTAINERS = {
  vm103: ['gitea', 'radarr', 'sonarr', 'immich-server', 'postgres'],
  pi: ['adguard'],
};
// Kuma's monitors: heartbeat status 0 down, 1 up, 2 pending, 3 maintenance.
const MONITORS = [
  [1, 'gitea'],
  [2, 'radarr'],
  [3, 'sonarr'],
  [4, 'Immich'],
  [5, 'NAS (Ping)'], // no container
];
const world = { prometheus: 'ok', nut: 1, kuma: { 1: 1, 2: 0, 3: 2, 4: 3, 5: 2 } };

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  body: null,
  json: async () => body,
});
const vector = (result) => json(200, { status: 'success', data: { resultType: 'vector', result } });
const sample = (value, metric = {}) => ({ metric, value: [EVAL, String(value)] });

function promAnswer(q) {
  if (world.prometheus === 'down')
    return json(500, { status: 'error', errorType: 'internal', error: 'boom' });
  if (q.includes('nut_')) {
    return vector([
      sample(world.nut, { __name__: 'nut_status' }),
      // The exporter gives charge and load as fractions; /api/ups serves percent.
      sample(0.87, { __name__: 'nut_battery_charge' }),
      sample(1200, { __name__: 'nut_battery_runtime_seconds' }),
      sample(0.23, { __name__: 'nut_load' }),
    ]);
  }
  const nodes = [...q.matchAll(/node=~"([^"]+)"/g)].flatMap((m) => m[1].split('|'));
  const perNode = (fn) =>
    vector(nodes.flatMap((node) => fn(node).map((s) => ({ ...s, metric: { node, ...s.metric } }))));
  if (q.includes('container_')) {
    const names = (node) => CONTAINERS[node] || [];
    if (q.includes('container_last_seen'))
      return perNode((node) => names(node).map((name) => sample(EVAL - 5, { name })));
    return perNode((node) => names(node).map((name) => sample(1, { name })));
  }
  if (q.includes('up{')) return perNode(() => [sample(1)]);
  if (q.includes('node_cpu_seconds_total')) return perNode(() => [sample(25)]);
  if (q.includes('MemTotal')) {
    return perNode(() => [
      sample(8 * GiB, { __name__: 'node_memory_MemTotal_bytes' }),
      sample(4 * GiB, { __name__: 'node_memory_MemAvailable_bytes' }),
      sample(2 * GiB, { __name__: 'node_memory_MemFree_bytes' }),
    ]);
  }
  if (q.includes('node_time_seconds')) return perNode(() => [sample(3600)]);
  if (q.includes('node_hwmon_temp_celsius')) return perNode(() => [sample(48)]);
  if (q.includes('node_filesystem_size_bytes')) {
    return perNode(() => [
      sample(100 * GiB, { __name__: 'node_filesystem_size_bytes', mountpoint: '/' }),
      sample(50 * GiB, { __name__: 'node_filesystem_free_bytes', mountpoint: '/' }),
    ]);
  }
  return vector([]);
}

function kumaAnswer(u) {
  if (u.includes('/api/status-page/heartbeat/')) {
    return json(200, {
      heartbeatList: Object.fromEntries(
        MONITORS.map(([id]) => [id, [{ status: world.kuma[id], ping: 5, time: null }]])
      ),
      uptimeList: {},
    });
  }
  if (u.includes('/api/status-page/')) {
    return json(200, {
      publicGroupList: [{ monitorList: MONITORS.map(([id, name]) => ({ id, name })) }],
    });
  }
  return json(404, {});
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith(PROM)) return promAnswer(decodeURIComponent(u));
  if (u.startsWith(KUMA)) return kumaAnswer(u);
  return realFetch(url, init);
};

after(() => {
  globalThis.fetch = realFetch;
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

/** One background cycle's refreshes and status step; returns the status. */
async function cycle() {
  await Promise.all([refreshServices(), refreshUPS()]);
  return updateStatus([]);
}
const get = (path) => request(app).get(path).set('x-auth-token', token);
const cardsOf = (body) => Object.values(body.nodes).flatMap((n) => n.services);
const cardOf = (body, uid) => cardsOf(body).find((c) => c.uid === uid);
const entityOf = (status, id) => status.entities.find((e) => e.id === id);

// Every key, at any depth, of a JSON value.
const keysOf = (v) =>
  v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : [];
const MODEL_ONLY = ['state', 'word', 'reason', 'kumaStatus', 'conditions', 'since'];

// ── The frozen shapes ────────────────────────────────────────────────────

// `beats` (#312, the heartbeat strips) is a key added beside the frozen ones,
// as §6.3 adds a field rather than change one: an older app reads `nodes`,
// `overallHealth` and `sources` as before and never looks at it.
const SERVICES_KEYS = ['nodes', 'overallHealth', 'sources', 'beats'];
const NODE_KEYS = [
  'display_name',
  'subtitle',
  'icon',
  'border_color',
  'reachable',
  'failedReads',
  'metrics',
  'services',
];
const METRICS_KEYS = [
  'cpu',
  'memUsedGB',
  'memTotalGB',
  'memPercent',
  'memWithCachePercent',
  'memCacheGB',
  'uptime',
  'temp',
  'diskUsed',
  'diskTotal',
  'diskUnit',
  'diskPercent',
];
const CARD_KEYS = [
  'container',
  'uid',
  'display_name',
  'icon',
  'status',
  'monitored',
  'ping',
  'uptime24',
  'docker',
  'integration',
  'source',
];
const DOCKER_KEYS = [
  'cpu',
  'memMB',
  'rxMB',
  'txMB',
  'rxBytesPerSec',
  'txBytesPerSec',
  'networkMode',
];
const UPS_KEYS = ['status', 'charge', 'runtime', 'load', 'ok', 'configured', 'model'];
const CARD_STATUSES = ['up', 'down', 'unknown'];
const HEALTH = ['down', 'degraded', 'up', 'unknown'];

// ── /api/services ────────────────────────────────────────────────────────

test('contract /api/services: its shape, and pending and maintenance still read as unknown', async () => {
  const status = await cycle();
  const before = JSON.stringify(getCached('services'));
  const r = await get('/api/services');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), SERVICES_KEYS);
  assert.deepEqual(r.body.sources, { prometheus: { ok: true }, kuma: { ok: true } });
  assert.deepEqual(Object.keys(r.body.nodes), ['vm103', 'pi']);
  for (const [key, n] of Object.entries(r.body.nodes)) {
    assert.deepEqual(Object.keys(n), NODE_KEYS, key);
    assert.deepEqual(Object.keys(n.metrics), METRICS_KEYS, key);
    assert.equal(n.reachable, true);
    assert.deepEqual(n.failedReads, []);
  }
  for (const c of cardsOf(r.body)) {
    assert.deepEqual(Object.keys(c), CARD_KEYS, c.uid);
    assert.ok(CARD_STATUSES.includes(c.status), `${c.uid}: ${c.status}`);
    assert.deepEqual(Object.keys(c.docker), DOCKER_KEYS, c.uid);
  }
  assert.ok(HEALTH.includes(r.body.overallHealth));
  assert.equal(r.body.overallHealth, 'down', 'radarr is down');

  // The meaning of each card's status, as before #290.
  const statusOf = (uid) => [cardOf(r.body, uid)?.status, cardOf(r.body, uid)?.monitored];
  assert.deepEqual(statusOf('vm103:gitea'), ['up', true]);
  assert.deepEqual(statusOf('vm103:radarr'), ['down', true]);
  assert.deepEqual(statusOf('vm103:sonarr'), ['unknown', true], 'pending: unknown, as today');
  assert.deepEqual(
    statusOf('vm103:immich-server'),
    ['unknown', true],
    'maintenance: unknown, as today'
  );
  assert.deepEqual(
    statusOf('vm103:postgres'),
    ['up', false],
    'a running container with no monitor'
  );
  assert.equal(
    cardOf(r.body, 'vm103:NAS (Ping)'),
    undefined,
    'a pending monitor with no container draws no card'
  );
  assert.deepEqual(
    keysOf(r.body).filter((k) => MODEL_ONLY.includes(k)),
    [],
    'nothing of the model leaks in'
  );
  assert.equal(
    JSON.stringify(getCached('services')),
    before,
    'building the status changed nothing in the payload'
  );

  // The same cycle in /api/status: maintenance is its own state there.
  assert.equal(entityOf(status, 'services/vm103:immich-server').state, 'maintenance');
  assert.equal(entityOf(status, 'services/vm103:radarr').state, 'crit');
});

test('contract /api/services: pending past one cycle is a warning in /api/status only', async () => {
  const status = await cycle(); // sonarr's and NAS (Ping)'s second pending cycle
  const r = await get('/api/services');
  assert.equal(cardOf(r.body, 'vm103:sonarr').status, 'unknown');
  const sonarr = entityOf(status, 'services/vm103:sonarr');
  assert.deepEqual([sonarr.state, sonarr.word], ['warn', 'Pending']);
  assert.ok(
    status.entities.some(
      (e) => e.kind === 'service' && e.name === 'NAS (Ping)' && e.state === 'warn'
    )
  );
});

test('contract /api/services: Prometheus failing keeps the shape; unknown-from-source is in /api/status only', async () => {
  world.prometheus = 'down';
  try {
    await cycle();
    const status = await cycle();
    const r = await get('/api/services');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body), SERVICES_KEYS);
    assert.deepEqual(r.body.sources, { prometheus: { ok: false }, kuma: { ok: true } });
    for (const n of Object.values(r.body.nodes)) assert.deepEqual(Object.keys(n), NODE_KEYS);
    for (const c of cardsOf(r.body))
      assert.ok(CARD_STATUSES.includes(c.status), `${c.uid}: ${c.status}`);
    assert.ok(HEALTH.includes(r.body.overallHealth));
    assert.deepEqual(
      keysOf(r.body).filter((k) => MODEL_ONLY.includes(k)),
      []
    );

    const vm103 = entityOf(status, 'nodes/vm103');
    assert.deepEqual([vm103.state, vm103.reason], ['unknown', 'No data: Prometheus unreachable']);
    assert.equal(status.sources.prometheus.state, 'failed');
  } finally {
    world.prometheus = 'ok';
  }
});

// ── /api/ups ─────────────────────────────────────────────────────────────

test("contract /api/ups: its shape; status is NUT's number, whatever the model calls it", async () => {
  world.nut = 2; // on battery
  try {
    const status = await cycle();
    const r = await get('/api/ups');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body), UPS_KEYS);
    assert.deepEqual(r.body, {
      status: 2,
      charge: 87,
      runtime: 1200,
      load: 23,
      ok: true,
      configured: true,
      model: null,
    });
    assert.deepEqual(
      [entityOf(status, 'power/ups').state, entityOf(status, 'power/ups').word],
      ['crit', 'On battery']
    );
  } finally {
    world.nut = 1;
  }
  const ok = await (async () => (await cycle(), get('/api/ups')))();
  assert.equal(ok.body.status, 1);
});

test('contract /api/ups: the query failing is ok: false with every value null and configured not known', async () => {
  world.prometheus = 'down';
  try {
    await cycle();
    const r = await get('/api/ups');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {
      status: null,
      charge: null,
      runtime: null,
      load: null,
      ok: false,
      configured: null,
      model: null,
    });
  } finally {
    world.prometheus = 'ok';
  }
});

// ── /api/cron/status ─────────────────────────────────────────────────────

test("contract /api/cron/status: its shape, and a run's status is success or failure", async () => {
  const report = (body) =>
    request(app)
      .post('/api/cron/report')
      .send({ secret: 'cron-s3cret', ...body }); // pragma: allowlist secret
  assert.equal(
    (await report({ node: 'vm103', job: 'restic', status: 'success', duration_seconds: 12 }))
      .status,
    200
  );
  assert.equal(
    (
      await report({
        node: 'pi',
        job: 'sync',
        status: 'failure',
        error: 'exit 3',
        expected_every_seconds: 3600,
        schedule: 'hourly',
      })
    ).status,
    200
  );
  const status = await cycle();
  const r = await get('/api/cron/status');
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'private, max-age=60');
  assert.deepEqual(
    r.body.map((n) => n.node),
    ['pi', 'vm103']
  );
  for (const n of r.body) assert.deepEqual(Object.keys(n), ['node', 'jobs']);
  const [pi, vm103] = r.body;
  assert.deepEqual(Object.keys(vm103.jobs[0]), ['job', 'runs', 'overdue', 'seconds_since_report']);
  assert.deepEqual(Object.keys(pi.jobs[0]), [
    'job',
    'runs',
    'overdue',
    'seconds_since_report',
    'expected_every_seconds',
  ]);
  assert.deepEqual(Object.keys(vm103.jobs[0].runs[0]), ['status', 'timestamp', 'duration_seconds']);
  assert.deepEqual(Object.keys(pi.jobs[0].runs[0]), [
    'status',
    'timestamp',
    'duration_seconds',
    'schedule',
    'error',
    'expected_every_seconds',
  ]);
  assert.deepEqual(
    [
      vm103.jobs[0].runs[0].status,
      vm103.jobs[0].overdue,
      pi.jobs[0].runs[0].status,
      pi.jobs[0].overdue,
    ],
    ['success', false, 'failure', false]
  );
  assert.deepEqual(
    keysOf(r.body).filter((k) => MODEL_ONLY.includes(k)),
    []
  );
  // The same jobs in /api/status.
  assert.deepEqual(
    [entityOf(status, 'jobs/pi:sync').state, entityOf(status, 'jobs/pi:sync').reason],
    ['warn', 'Last run failed: exit 3']
  );
});
