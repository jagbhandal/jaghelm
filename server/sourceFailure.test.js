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
 * each starts its own push snapshot, so its first cycle with every source
 * answering is a fresh baseline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

const { initDiscovery } = await import('./discovery.js');
const { initMonitors } = await import('./monitors.js');
const { saveConfig } = await import('./config.js');
const { getCached, getCachedInternal } = await import('./cache.js');
const { refreshServices, refreshUPS } = await import('./refresh.js');
const { pushPipeline } = await import('./testing/pushPipeline.js');
const { servicesRoutes } = await import('./routes/services.js');

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
  // 'fresh': Prometheus answers every query, but has scraped nothing yet.
  prometheus: 'ok', // 'ok' | 'http500' | 'timeout' | 'containers500' | 'fresh'
  kuma: 'ok', // 'ok' | 'http500' | 'refused'
  up: { vm103: 1, pi: 1, nas: 1 },
  radarr: 'down', // Kuma's status for radarr
  nasPing: 'up', // Kuma's status for "NAS (Ping)", a monitor no container has (#390)
  ups: 1, // nut_status: 1 online, 2 on battery
  rejects: null, // (query) => true for a query Prometheus answers with HTTP 400
};

function reset() {
  Object.assign(world, {
    prometheus: 'ok',
    kuma: 'ok',
    up: { vm103: 1, pi: 1, nas: 1 },
    radarr: 'down',
    nasPing: 'up',
    ups: 1,
    rejects: null,
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
  if (world.rejects?.(q)) return json(400, { status: 'error', errorType: 'bad_data', error: 'parse error' });
  if (world.prometheus === 'fresh') return vector([]);
  // One query reads the four UPS series, told apart by name (#234).
  if (q.includes('nut_')) {
    return vector([
      sample(world.ups, { __name__: 'nut_status' }),
      ...['nut_battery_charge', 'nut_battery_runtime_seconds', 'nut_load'].map((n) => sample(1, { __name__: n })),
    ]);
  }

  // One query covers every node, node=~"vm103|pi|nas" (#234): each sample
  // carries its `node` label, and series that share a query their name.
  const nodes = [...q.matchAll(/node=~"([^"]+)"/g)].flatMap((m) => m[1].split('|'));
  const perNode = (fn) => vector(nodes.flatMap((node) => fn(node).map((s) => ({ ...s, metric: { node, ...s.metric } }))));
  if (q.includes('container_')) {
    if (world.prometheus === 'containers500') {
      return json(500, { status: 'error', errorType: 'internal', error: 'boom' });
    }
    const names = (node) => CONTAINERS[node] || [];
    if (q.includes('container_last_seen')) return perNode((node) => names(node).map((name) => sample(EVAL - 5, { name })));
    return perNode((node) => names(node).map((name) => sample(1, { name })));
  }
  if (q.includes('up{')) return perNode((node) => [sample(world.up[node])]);
  if (q.includes('node_cpu_seconds_total')) return perNode(() => [sample(25)]);
  if (q.includes('MemTotal')) {
    return perNode(() => [
      sample(8 * GiB, { __name__: 'node_memory_MemTotal_bytes' }),
      sample(4 * GiB, { __name__: 'node_memory_MemAvailable_bytes' }),
      sample(2 * GiB, { __name__: 'node_memory_MemFree_bytes' }),
    ]);
  }
  if (q.includes('node_time_seconds')) return perNode(() => [sample(3600)]);
  if (q.includes('node_filesystem_size_bytes')) {
    return perNode(() => [
      sample(100 * GiB, { __name__: 'node_filesystem_size_bytes', mountpoint: '/' }),
      sample(50 * GiB, { __name__: 'node_filesystem_free_bytes', mountpoint: '/' }),
    ]);
  }
  return vector([]);
}

function kumaAnswer() {
  if (world.kuma === 'http500') return json(500, {});
  if (world.kuma === 'refused') throw new TypeError('fetch failed');
  const statusOf = { gitea: 1, radarr: world.radarr === 'up' ? 1 : 0, nasPing: world.nasPing === 'up' ? 1 : 0 };
  return json(200, {
    publicGroupList: [{ monitorList: [{ id: 1, name: 'gitea' }, { id: 2, name: 'radarr' }, { id: 3, name: 'NAS (Ping)' }] }],
    heartbeatList: {
      1: [{ status: statusOf.gitea, ping: 5 }],
      2: [{ status: statusOf.radarr, ping: 0 }],
      3: [{ status: statusOf.nasPing, ping: 1 }],
    },
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

const caches = { getCached, getCachedInternal, getAllCronStatuses: () => [] };

// A fresh push pipeline: its first cycle is the baseline. Given the `path` of
// another pipeline's snapshot file, it is that pipeline after a restart. Each
// cycle builds the status model and push from it, as refresh.js does (#292).
function pipeline({ path } = {}) {
  const p = pushPipeline({ path, env: { KUMA_URL: KUMA } });
  return {
    path: p.path,
    sent: p.sent,
    events: p.events,
    get status() {
      return p.status;
    },
    get snapshot() {
      return p.snapshot;
    },
    // `refresh: false` runs the push side only, as when the refreshes failed;
    // `from` replaces the caches the snapshot is built from.
    async cycle({ refresh = true, from = caches } = {}) {
      if (refresh) await Promise.all([refreshServices(), refreshUPS()]);
      await p.cycle(from);
    },
    done() {
      p.close();
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
  // #292: one "monitoring source down" push for the outage, not one per host,
  // service or the UPS it fed, and one when it is back.
  test(`Prometheus failing (${failure}) for two cycles pages once that it is down, and once that it is back`, async () => {
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

      assert.deepEqual(p.sent, ['source_down prometheus'], 'its second failed cycle: one push, nothing per host');

      world.prometheus = 'ok';
      await p.cycle();
      assert.equal(getCached('services').sources.prometheus.ok, true);
      assert.deepEqual(
        p.sent,
        ['source_down prometheus', 'source_recovered prometheus'],
        'no host_unreachable, no host_recovered: one each way for the source'
      );
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
    assert.equal(before.services['vm103:gitea'], 'up');
    assert.equal(before.ups.state, 'online');

    world.prometheus = 'http500';
    await p.cycle();
    const held = p.snapshot.prev();
    // What the next cycle diffs against is unchanged, but for the source.
    for (const key of ['services', 'monitorOf', 'hosts', 'ups', 'cron']) assert.deepEqual(held[key], before[key], key);
    assert.deepEqual(held.sources, { kuma: 'ok', nut: 'ok', prometheus: 'failing' });
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
    // Sent when Kuma reports it (#390): no container is seen, so the up monitor
    // is an up entry under its card's uid. Prometheus has failed twice by now.
    assert.deepEqual(
      p.sent,
      ['service_down vm103:radarr', 'service_recovered vm103:radarr', 'source_down prometheus'],
      'in the outage cycle'
    );
    world.prometheus = 'ok';
    await p.cycle();
    assert.deepEqual(p.sent, [
      'service_down vm103:radarr',
      'service_recovered vm103:radarr',
      'source_down prometheus',
      'source_recovered prometheus',
    ]);
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

// ── #232 review ──────────────────────────────────────────────────────────

test('one metric query failing does not hold host_unreachable for any node', async () => {
  reset();
  const p = pipeline();
  try {
    await p.cycle();
    // Every cycle from now on, the temperature query is a 400 (a query that
    // always fails: a bad label, or one that always times out). It covers every
    // node (#234), so every node's temperature read fails, and nothing else.
    world.rejects = (q) => q.includes('node_hwmon_temp_celsius');
    await p.cycle();
    world.up.pi = 0;
    for (let i = 0; i < 5; i += 1) await p.cycle();
    assert.equal(getCached('services').sources.prometheus.ok, false, 'Prometheus counts as failing');
    assert.deepEqual(getCached('services').nodes.nas.failedReads, ['temp']);
    assert.deepEqual(p.sent, ['host_unreachable pi', 'source_down prometheus'], 'pi still pages');
    assert.match(p.events.find((e) => e.type === 'source_down').body, /^Prometheus · /, 'the source push says why');

    world.up.pi = 1;
    await p.cycle();
    assert.deepEqual(p.sent, ['host_unreachable pi', 'source_down prometheus', 'host_recovered pi']);
  } finally {
    p.done();
  }
});

test('a cold cache after a restart is a failed source: nothing is re-sent on the next good cycle', async () => {
  reset();
  const before = pipeline();
  let after = null;
  try {
    await before.cycle(); // baseline written: three reachable hosts, radarr down (already paged)
    after = pipeline({ path: before.path }); // the restart
    const cold = { ...caches, getCached: () => null };
    await after.cycle({ refresh: false, from: cold }); // the first refresh threw
    await after.cycle();
    assert.deepEqual(after.sent, [], 'no host_recovered, no repeat service_down');
  } finally {
    after?.done();
    before.done();
  }
});

test('a cache past its TTL is a failed source: nothing is re-sent, and the UPS going on battery is', async () => {
  reset();
  const p = pipeline();
  try {
    await p.cycle();
    Date.now = () => realNow() + 121_000; // the refreshes failed for longer than the 120 s TTL
    assert.equal(getCached('services'), null);
    await p.cycle({ refresh: false });
    clockBack();

    world.ups = 2;
    await p.cycle();
    assert.deepEqual(p.sent, ['ups_on_battery ups'], 'online was held, so on battery is a change');
  } finally {
    clockBack();
    p.done();
  }
});

test('booting during a Prometheus outage takes no baseline until it answers, so its recovery sends nothing', async () => {
  reset();
  world.prometheus = 'http500';
  const p = pipeline();
  try {
    await p.cycle();
    await p.cycle();
    assert.equal(p.snapshot.prev(), null, 'no baseline from a failed cycle');

    world.prometheus = 'ok';
    await p.cycle(); // the baseline
    await p.cycle();
    assert.equal(p.snapshot.prev().hosts.pi.reachable, true);
    assert.deepEqual(p.sent, [], 'no host_recovered');
  } finally {
    p.done();
  }
});

test('Prometheus answering with no up series after it had some counts as failed, so no host pages', async () => {
  reset();
  const p = pipeline();
  try {
    await p.cycle();
    // Back after an outage longer than its lookback, before its first scrape:
    // every query answers, with no series at all.
    world.prometheus = 'fresh';
    await p.cycle();
    await p.cycle();
    assert.equal(getCached('services').sources.prometheus.ok, false);
    assert.deepEqual(p.snapshot.prev().hosts.pi, {
      reachable: true,
      levels: { cpu: 'ok', disk: 'ok', mem: 'ok' },
    });

    world.prometheus = 'ok';
    await p.cycle();
    assert.equal(getCached('services').sources.prometheus.ok, true, 'the up series are back');
    assert.deepEqual(
      p.sent,
      ['source_down prometheus', 'source_recovered prometheus'],
      'no host_unreachable, no host_recovered'
    );
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

      assert.deepEqual(p.sent, ['source_down kuma'], 'one push for Kuma, none for radarr');

      world.kuma = 'ok';
      await p.cycle();
      assert.deepEqual(
        p.sent,
        ['source_down kuma', 'source_recovered kuma'],
        'no service_recovered, then no repeat service_down'
      );
    } finally {
      clockBack();
      p.done();
    }
  });
}

// A monitor no container has (#390): its uid is on the first node, from its
// name, and it is in the push snapshot whether it is up or down.
const NAS_PING = 'vm103:NAS (Ping)';

test('a monitor no container has: Kuma failing and recovering while it is down sends no recovery; its real one is sent', async () => {
  reset();
  const p = pipeline();
  try {
    await p.cycle(); // baseline: NAS (Ping) up
    assert.equal(p.snapshot.prev().services[NAS_PING], 'up');
    world.nasPing = 'down';
    await p.cycle();
    assert.deepEqual(p.sent, [`service_down ${NAS_PING}`]);

    world.kuma = 'http500';
    afterKumaCeiling(); // Kuma serves nothing now: no card, no up entry
    await p.cycle();
    await p.cycle();
    assert.equal(getCached('services').sources.kuma.ok, false);
    assert.equal(p.snapshot.prev().services[NAS_PING], 'down', 'held like every other service');

    world.kuma = 'ok'; // back, with NAS (Ping) still down
    await p.cycle();
    clockBack();
    await p.cycle();
    const kuma = ['source_down kuma', 'source_recovered kuma'];
    assert.deepEqual(p.sent, [`service_down ${NAS_PING}`, ...kuma], 'no service_recovered, and no repeat service_down');

    world.nasPing = 'up';
    await p.cycle();
    assert.deepEqual(p.sent, [`service_down ${NAS_PING}`, ...kuma, `service_recovered ${NAS_PING}`]);
    const cardsNow = Object.values(getCached('services').nodes).flatMap((n) => n.services);
    assert.equal(cardsNow.some((s) => s.uid === NAS_PING), false, 'up, it has no card on the board');
  } finally {
    clockBack();
    p.done();
  }
});

test('a monitor no container has: its up entry is in the push snapshot, not in the served /api/services', async () => {
  reset();
  const p = pipeline();
  try {
    await p.cycle(); // NAS (Ping) up
    assert.equal(p.snapshot.prev().services[NAS_PING], 'up');
    const app = express();
    app.use('/api/services', servicesRoutes);
    const r = await request(app).get('/api/services');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['nodes', 'overallHealth', 'sources']);
    assert.equal(r.text.includes('NAS (Ping)'), false, 'up, the monitor is nowhere in the payload');
  } finally {
    p.done();
  }
});

test('a monitor no container has: upWithoutCard is kept beside the cached payload, at no level inside it', async () => {
  reset();
  const p = pipeline();
  try {
    await p.cycle(); // NAS (Ping) up
    // What /api/services serves and takes its ETag from.
    const keysOf = (v) => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
    assert.equal(keysOf(getCached('services')).includes('upWithoutCard'), false, 'not in the served data');
    assert.ok(getCachedInternal('services').upWithoutCard.includes(NAS_PING), 'kept beside it for push');
  } finally {
    p.done();
  }
});

test('the monitor each monitored key carries is kept beside the cached payload, and in the push snapshot (#395)', async () => {
  reset();
  const p = pipeline();
  try {
    await p.cycle(); // gitea and radarr have their monitors; NAS (Ping) is up with no container
    const keysOf = (v) => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
    assert.equal(keysOf(getCached('services')).includes('monitorOf'), false, 'not in the served data');
    const want = { [NAS_PING]: '3', 'vm103:gitea': '1', 'vm103:radarr': '2' };
    assert.deepEqual(getCachedInternal('services').monitorOf, want, 'kept beside it for push');
    assert.deepEqual(p.snapshot.prev().monitorOf, want, 'postgres and adguard have no monitor');
  } finally {
    p.done();
  }
});

test('a monitor no container has: a restart while it is down sends exactly one recovery', async () => {
  reset();
  const before = pipeline();
  let after = null;
  try {
    await before.cycle(); // baseline: NAS (Ping) up
    world.nasPing = 'down';
    await before.cycle();
    assert.deepEqual(before.sent, [`service_down ${NAS_PING}`]);
    before.snapshot.flush(); // the shutdown

    after = pipeline({ path: before.path }); // the restart
    const cold = { ...caches, getCached: () => null, getCachedInternal: () => null };
    await after.cycle({ refresh: false, from: cold }); // the first refresh threw
    await after.cycle(); // still down
    assert.deepEqual(after.sent, [], 'no repeat service_down');
    world.nasPing = 'up';
    await after.cycle();
    assert.deepEqual(after.sent, [`service_recovered ${NAS_PING}`]);
  } finally {
    after?.done();
    before.done();
  }
});

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

// ── The status model (#290) ──────────────────────────────────────────────
//
// The same pipeline into the status model: the real refreshes, the real
// caches read by readStatusInputs, one tracker carrying its memory. A failed
// source is one issue, and what it feeds is no signal, never crit.

const { createStatusTracker, readStatusInputs } = await import('./status/index.js');
const { DEFAULT_THRESHOLDS } = await import('./status/thresholds.js');

function statusPipeline() {
  const tracker = createStatusTracker();
  return async function cycle() {
    await Promise.all([refreshServices(), refreshUPS()]);
    const inputs = readStatusInputs(caches, { env: { KUMA_URL: KUMA } });
    return tracker.update({ inputs, thresholds: DEFAULT_THRESHOLDS, now: Date.now() });
  };
}

const critIds = (s) => s.entities.filter((e) => e.state === 'crit').map((e) => e.id);
const sourceIssueIds = (s) => s.issues.filter((i) => i.kind === 'source').map((i) => i.id);

for (const failure of ['http500', 'timeout']) {
  test(`status model: Prometheus failing (${failure}) is one source issue, its entities no signal, no crit`, async () => {
    reset();
    world.radarr = 'up';
    const cycle = statusPipeline();
    const before = await cycle();
    assert.equal(before.overall.state, 'ok');
    assert.deepEqual(before.issues, []);

    world.prometheus = failure;
    const after = await cycle();
    assert.deepEqual(critIds(after), []);
    assert.deepEqual(sourceIssueIds(after), ['sources/prometheus']);
    assert.match(after.sources.prometheus.error, failure === 'http500' ? /HTTP 500/ : /timeout/);
    for (const id of ['nodes/vm103', 'nodes/pi', 'nodes/nas', 'power/ups', 'services/vm103:postgres', 'services/pi:adguard']) {
      const e = after.entities.find((x) => x.id === id);
      assert.deepEqual([e?.state, e?.reason], ['unknown', 'No data: Prometheus unreachable'], id);
    }
    // Kuma still answers: its services are judged, here up.
    assert.equal(after.entities.find((x) => x.id === 'services/vm103:radarr').state, 'ok');
    assert.equal(after.sources.kuma.state, 'ok');
  });
}

test('status model: Kuma failing past its ceiling is one source issue; a service it had down is no signal, not crit', async () => {
  reset(); // radarr down
  const cycle = statusPipeline();
  try {
    const before = await cycle();
    assert.deepEqual(critIds(before), ['services/vm103:radarr']);

    world.kuma = 'refused';
    afterKumaCeiling();
    const after = await cycle();
    assert.deepEqual(critIds(after), []);
    assert.deepEqual(sourceIssueIds(after), ['sources/kuma']);
    const radarr = after.entities.find((x) => x.id === 'services/vm103:radarr');
    assert.deepEqual([radarr.kind, radarr.state, radarr.reason], ['service', 'unknown', 'No data: Kuma unreachable']);
    assert.equal(after.sources.kuma.error, 'fetch failed');
    assert.ok(after.entities.filter((e) => e.subsystem === 'nodes').every((e) => e.state === 'ok'));
  } finally {
    clockBack();
  }
});

test('status model: why a source failed is kept beside the cached payload, not in it', async () => {
  reset();
  world.prometheus = 'http500';
  await refreshServices();
  const keysOf = (v) => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
  assert.equal(keysOf(getCached('services')).includes('sourceErrors'), false, 'not in the served data');
  assert.match(getCachedInternal('services').sourceErrors.prometheus, /HTTP 500/);
  assert.equal(getCachedInternal('services').sourceErrors.kuma, null);
});
