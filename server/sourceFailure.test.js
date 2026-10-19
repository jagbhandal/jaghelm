/**
 * A failed Prometheus or Kuma poll is not an outage of everything they watch
 * (#232). It used to read as one: a failed Prometheus query returned the same []
 * as "no series", so every node lost its metrics and the push differ sent
 * host_unreachable for each host, then host_recovered for each when Prometheus
 * came back. Kuma past its 5-minute stale ceiling returned {} the same way.
 *
 * These tests drive the real pipeline end to end: discovery and monitors against
 * a stubbed fetch, the real services and UPS refreshes into the real cache, then
 * the real snapshot builder, differ and push cycle, sending to a recording FCM.
 *
 * Tests share module state (cache, registries, the Kuma cache) and run in order;
 * each starts its own push snapshot, so its first cycle is a fresh baseline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { initDiscovery } = await import('./discovery.js');
const { initMonitors } = await import('./monitors.js');
const { saveConfig } = await import('./config.js');
const { getCached } = await import('./cache.js');
const { refreshServices, refreshUPS } = await import('./refresh.js');
const { buildSnapshot } = await import('./push/snapshot.js');
const { createPushSnapshot, runPushCycle } = await import('./push/dispatch.js');

const PROM = 'http://localhost:9998';
const KUMA = 'http://localhost:9999';
initDiscovery(PROM);
initMonitors(KUMA);

saveConfig({
  nodes: {
    vm103: { display_name: 'VM 103' },
    pi: { display_name: 'Pi' },
    nas: { display_name: 'NAS' },
  },
  services: {},
});

// ── The homelab the stub serves ──────────────────────────────────────────

const GiB = 1073741824;
const EVAL = 1_700_000_000; // Prometheus' evaluation time for every sample
const CONTAINERS = { vm103: ['gitea', 'radarr', 'postgres'], pi: ['adguard'], nas: [] };

// What each upstream does this cycle. Tests change it between cycles.
const world = {
  prometheus: 'ok', // 'ok' | 'http500' | 'timeout' | 'containers500'
  kuma: 'ok', // 'ok' | 'http500' | 'refused'
  up: { vm103: 1, pi: 1, nas: 1 },
  radarr: 'down', // Kuma's status for radarr
  ups: 1, // nut_status: 1 online, 2 on battery
};

function reset() {
  Object.assign(world, {
    prometheus: 'ok',
    kuma: 'ok',
    up: { vm103: 1, pi: 1, nas: 1 },
    radarr: 'down',
    ups: 1,
  });
}

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
  if (world.prometheus === 'http500') {
    return json(500, { status: 'error', errorType: 'internal', error: 'boom' });
  }
  if (world.prometheus === 'timeout') {
    // What AbortSignal.timeout makes fetch reject with.
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }
  if (q.includes('nut_status')) return vector([sample(world.ups)]);
  if (q.includes('nut_')) return vector([sample(1)]);

  const node = /node="([^"]+)"/.exec(q)?.[1];
  if (q.includes('container_')) {
    if (world.prometheus === 'containers500') {
      return json(500, { status: 'error', errorType: 'internal', error: 'boom' });
    }
    const names = CONTAINERS[node] || [];
    if (q.includes('container_last_seen')) return vector(names.map((name) => sample(EVAL - 5, { name })));
    return vector(names.map((name) => sample(1, { name })));
  }
  if (q.includes('up{')) return vector([sample(world.up[node])]);
  if (q.includes('node_cpu_seconds_total')) return vector([sample(25)]);
  if (q.includes('MemTotal')) return vector([sample(8 * GiB)]);
  if (q.includes('MemAvailable')) return vector([sample(4 * GiB)]);
  if (q.includes('MemFree')) return vector([sample(2 * GiB)]);
  if (q.includes('node_time_seconds')) return vector([sample(3600)]);
  if (q.includes('node_filesystem_size_bytes')) return vector([sample(100 * GiB, { mountpoint: '/' })]);
  if (q.includes('node_filesystem_free_bytes')) return vector([sample(50 * GiB, { mountpoint: '/' })]);
  return vector([]);
}

function kumaAnswer() {
  if (world.kuma === 'http500') return json(500, {});
  if (world.kuma === 'refused') throw new TypeError('fetch failed');
  const statusOf = { gitea: 1, radarr: world.radarr === 'up' ? 1 : 0 };
  return json(200, {
    publicGroupList: [{ monitorList: [{ id: 1, name: 'gitea' }, { id: 2, name: 'radarr' }] }],
    heartbeatList: { 1: [{ status: statusOf.gitea, ping: 5 }], 2: [{ status: statusOf.radarr, ping: 0 }] },
    uptimeList: {},
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith(PROM)) return promAnswer(decodeURIComponent(u));
  if (u.startsWith(KUMA)) return kumaAnswer();
  throw new Error(`unexpected fetch ${u}`);
};
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

// ── The push side ────────────────────────────────────────────────────────

const THRESHOLDS = { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 };
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };
const caches = { getCached, getAllCronStatuses: () => [], now: () => 0 };

const store = {
  getAllTokens: () => [{ token: 'phone' }],
  getPrefs: () => ({
    enabled: true,
    notifyRecoveries: true,
    categories: { service: true, host: true, ups: true, cron: true },
  }),
  removeToken: () => true,
  pruneStale: () => 0,
  markDelivered: () => 0,
};

// A fresh push pipeline: its first cycle is the baseline.
function pipeline() {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-232-'));
  const snapshot = createPushSnapshot({ path: join(dir, 'push-snapshot.json'), logger: silentLog });
  const sent = [];
  const fcm = {
    isPushEnabled: () => true,
    sendToToken: async (token, event) => {
      sent.push(`${event.type} ${event.id}`);
      return { ok: true, prune: false };
    },
  };
  return {
    snapshot,
    sent,
    async cycle() {
      await Promise.all([refreshServices(), refreshUPS()]);
      await runPushCycle({
        buildSnapshotFn: (prev) => buildSnapshot(caches, prev),
        store,
        fcm,
        snapshot,
        thresholds: THRESHOLDS,
        logger: silentLog,
      });
    },
    done() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Kuma serves its last-known statuses for 5 minutes after a failed load; these
// cycles run past that, where it used to return {}.
const realNow = Date.now;
function afterKumaCeiling() {
  Date.now = () => realNow() + 10 * 60_000;
}
function clockBack() {
  Date.now = realNow;
}

// ── Prometheus ───────────────────────────────────────────────────────────

for (const failure of ['http500', 'timeout']) {
  test(`Prometheus failing (${failure}) for two cycles pages nothing, and nor does its recovery`, async () => {
    reset();
    const p = pipeline();
    try {
      await p.cycle(); // baseline: three reachable hosts, radarr down
      assert.equal(p.snapshot.prev().hosts.vm103.reachable, true);

      world.prometheus = failure;
      await p.cycle();
      await p.cycle();
      assert.equal(getCached('services').sources.prometheus.ok, false, 'the payload says Prometheus failed');
      assert.equal(getCached('services').sources.kuma.ok, true);
      assert.equal(getCached('ups').ok, false, 'the UPS read failed with it');

      world.prometheus = 'ok';
      await p.cycle();
      assert.equal(getCached('services').sources.prometheus.ok, true);
      assert.deepEqual(p.sent, [], 'no host_unreachable, no host_recovered, nothing');
    } finally {
      p.done();
    }
  });
}

test('the push snapshot keeps the previous hosts, services and UPS while Prometheus fails', async () => {
  reset();
  const p = pipeline();
  try {
    await p.cycle();
    const before = structuredClone(p.snapshot.prev());
    assert.deepEqual(Object.keys(before.hosts), ['nas', 'pi', 'vm103']);
    assert.equal(before.services['vm103:postgres'], 'up');
    assert.equal(before.ups.state, 'online');

    world.prometheus = 'http500';
    await p.cycle();
    assert.deepEqual(p.snapshot.prev(), before, 'what the next cycle diffs against is unchanged');
  } finally {
    p.done();
  }
});

test('a Kuma outage during a Prometheus failure still pages, and so does its recovery', async () => {
  reset();
  world.radarr = 'up';
  const p = pipeline();
  try {
    await p.cycle();
    world.prometheus = 'timeout';
    world.radarr = 'down'; // Kuma still answers: radarr went down
    await p.cycle();
    assert.deepEqual(p.sent, ['service_down vm103:radarr'], 'Kuma statuses keep paging');

    world.radarr = 'up'; // recovers while Prometheus is still failing
    await p.cycle();
    world.prometheus = 'ok';
    await p.cycle();
    assert.deepEqual(p.sent, ['service_down vm103:radarr', 'service_recovered vm103:radarr']);
  } finally {
    p.done();
  }
});

test('only the container queries failing pages nothing, and keeps the container services', async () => {
  reset();
  const p = pipeline();
  try {
    await p.cycle();
    const before = structuredClone(p.snapshot.prev().services);
    world.prometheus = 'containers500';
    await p.cycle();
    assert.equal(getCached('services').sources.prometheus.ok, false);
    assert.deepEqual(p.snapshot.prev().services, before);
    const presence = Object.values(getCached('services').nodes)
      .flatMap((n) => n.services)
      .filter((s) => s.source === 'presence');
    assert.deepEqual(presence, [], 'no grey breadcrumbs while presence is unknown');

    world.prometheus = 'ok';
    await p.cycle();
    assert.deepEqual(p.sent, []);
  } finally {
    p.done();
  }
});

test('the UPS going on battery while Prometheus was failing is sent once it answers again', async () => {
  reset();
  const p = pipeline();
  try {
    await p.cycle();
    world.prometheus = 'http500';
    await p.cycle();
    world.prometheus = 'ok';
    world.ups = 2;
    await p.cycle();
    assert.deepEqual(p.sent, ['ups_on_battery ups'], 'online, held through the failure, then on battery');
  } finally {
    p.done();
  }
});

test('a node whose up{node} is 0 while Prometheus is healthy still pages host_unreachable', async () => {
  reset();
  const p = pipeline();
  try {
    await p.cycle();
    // Every target on pi stopped answering. Its CPU series (an irate over 5m)
    // keeps a value for a few minutes after that; this stub keeps them all, so
    // only up{node="pi"} says the host is gone.
    world.up.pi = 0;
    await p.cycle();
    assert.equal(getCached('services').sources.prometheus.ok, true);
    assert.equal(getCached('services').nodes.pi.reachable, false);
    assert.deepEqual(p.sent, ['host_unreachable pi']);

    world.up.pi = 1;
    await p.cycle();
    assert.deepEqual(p.sent, ['host_unreachable pi', 'host_recovered pi']);
  } finally {
    p.done();
  }
});

// ── Kuma ─────────────────────────────────────────────────────────────────

for (const failure of ['http500', 'refused']) {
  test(`Kuma failing (${failure}) past its stale ceiling pages nothing, and nor does its recovery`, async () => {
    reset();
    const p = pipeline();
    try {
      await p.cycle(); // baseline: radarr down per Kuma, its container running
      assert.equal(p.snapshot.prev().services['vm103:radarr'], 'down');

      world.kuma = failure;
      afterKumaCeiling();
      await p.cycle();
      await p.cycle();
      assert.equal(getCached('services').sources.kuma.ok, false, 'the payload says Kuma failed');
      assert.equal(getCached('services').sources.prometheus.ok, true);
      assert.equal(p.snapshot.prev().services['vm103:radarr'], 'down', 'held, not "recovered"');

      world.kuma = 'ok';
      await p.cycle();
      assert.deepEqual(p.sent, [], 'no service_recovered, then no repeat service_down');
    } finally {
      clockBack();
      p.done();
    }
  });
}

// ── Logs ─────────────────────────────────────────────────────────────────

// The structured logger's JSON lines written while `fn` runs.
async function captureLogs(fn) {
  const lines = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const tap = (orig) =>
    function (chunk, ...rest) {
      try {
        const obj = JSON.parse(String(chunk));
        if (obj && obj.module && obj.level) {
          lines.push(obj);
          return true;
        }
      } catch {
        // not one of ours
      }
      return orig.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(origOut);
  process.stderr.write = tap(origErr);
  try {
    await fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return lines;
}

test('logs: Prometheus failing logs one warning, and its recovery one info line', async () => {
  reset();
  const p = pipeline();
  try {
    await p.cycle();
    const prometheusLines = (lines) => lines.filter((l) => l.source === 'prometheus');

    world.prometheus = 'http500';
    const failing = prometheusLines(await captureLogs(async () => {
      await p.cycle();
      await p.cycle();
      await p.cycle();
    }));
    assert.equal(failing.length, 1, 'one line for the whole outage');
    assert.equal(failing[0].level, 'warn');
    assert.match(failing[0].error, /HTTP 500/);

    world.prometheus = 'ok';
    const back = prometheusLines(await captureLogs(async () => {
      await p.cycle();
      await p.cycle();
    }));
    assert.equal(back.length, 1, 'one line for the recovery');
    assert.equal(back[0].level, 'info');
  } finally {
    p.done();
  }
});
