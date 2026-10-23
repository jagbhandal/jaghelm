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
 * each starts its own push snapshot, with nothing in it: its first cycle with
 * every source answering diffs every entity from no previous state (#448), so
 * what is down then (radarr, unless a test says otherwise) pages once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

const { initDiscovery, NODE_READS } = await import('./discovery.js');
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
  // 'fresh': Prometheus answers every query, but has scraped nothing yet: its
  // targets are known and not scraped (#470). 'empty': it scrapes, its targets
  // healthy, but stores nothing (a full disk failing its writes), so every
  // query answers with no series (#470).
  prometheus: 'ok', // 'ok' | 'http500' | 'timeout' | 'containers500' | 'fresh' | 'empty'
  kuma: 'ok', // 'ok' | 'http500' | 'refused'
  up: { vm103: 1, pi: 1, nas: 1 },
  radarr: 'down', // Kuma's status for radarr
  nasPing: 'up', // Kuma's status for "NAS (Ping)", a monitor no container has (#390); 'removed' takes it out of Kuma
  ups: 1, // nut_status: 1 online, 2 on battery
  rejects: null, // (query) => true for a query Prometheus answers with HTTP 400
  // #470: nodes Prometheus has no series and no target for (a host gone from it).
  gone: [],
  // #470: how /api/v1/targets answers: 'ok' (each node's targets, not gone),
  // or 'http403' (a proxy that lets only queries through). #477: 'none' (an
  // empty list) or 'federated' (only a federation target, with no node).
  targets: 'ok',
  // #476: nodes whose targets Prometheus never scrapes (a stuck scrape pool):
  // listed, "unknown", and no series.
  stuck: [],
  // #470: nodes whose node-exporter Prometheus hasn't scraped yet, while it has
  // their cAdvisor (a reboot): their `up` is world.up's (cAdvisor's), and they
  // have no other series.
  unscraped: [],
};
// How many times Prometheus's target list was read (#470).
let targetReads = 0;
// #476: when Prometheus started, as /api/v1/status/runtimeinfo says: a day
// before any test's clock.
const PROM_STARTED = new Date(EVAL * 1000 - 86_400_000).toISOString();

function reset() {
  Object.assign(world, {
    prometheus: 'ok',
    kuma: 'ok',
    up: { vm103: 1, pi: 1, nas: 1 },
    radarr: 'down',
    nasPing: 'up',
    ups: 1,
    rejects: null,
    gone: [],
    targets: 'ok',
    stuck: [],
    unscraped: [],
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
  if (world.prometheus === 'fresh' || world.prometheus === 'empty') return vector([]);
  // One query reads the four UPS series, told apart by name (#234).
  if (q.includes('nut_')) {
    return vector([
      sample(world.ups, { __name__: 'nut_status' }),
      ...['nut_battery_charge', 'nut_battery_runtime_seconds', 'nut_load'].map((n) => sample(1, { __name__: n })),
    ]);
  }

  // One query covers every node, node=~"vm103|pi|nas" (#234): each sample
  // carries its `node` label, and series that share a query their name.
  const nodes = [...q.matchAll(/node=~"([^"]+)"/g)]
    .flatMap((m) => m[1].split('|'))
    .filter((node) => !world.gone.includes(node) && !world.stuck.includes(node))
    .filter((node) => q.includes('up{') || !world.unscraped.includes(node));
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

// Prometheus's active targets (#470): each node's node-exporter and cAdvisor,
// scraped every 30 s unless it has just started (or, for node-exporter, the
// node is world.unscraped; for both, world.stuck).
function targetsAnswer() {
  targetReads += 1;
  if (world.prometheus === 'http500') return json(500, { status: 'error', errorType: 'internal', error: 'boom' });
  if (world.prometheus === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  if (world.targets === 'http403') return json(403, { status: 'error', error: 'forbidden' });
  if (world.targets === 'none') return json(200, { status: 'success', data: { activeTargets: [], droppedTargets: [] } });
  const fresh = world.prometheus === 'fresh';
  const target = (node, port, job, scraped) => ({
    labels: { instance: `${node}:${port}`, job, node },
    scrapePool: job,
    scrapeUrl: `http://${node}:${port}/metrics`,
    health: scraped ? (world.up[node] > 0 ? 'up' : 'down') : 'unknown',
    lastScrape: scraped ? new Date(EVAL * 1000).toISOString() : '0001-01-01T00:00:00Z',
    scrapeInterval: '30s',
  });
  if (world.targets === 'federated') {
    const federate = { ...target('leaf', 9090, 'federate', true), labels: { instance: 'leaf:9090', job: 'federate' }, health: 'up' };
    return json(200, { status: 'success', data: { activeTargets: [federate], droppedTargets: [] } });
  }
  const activeTargets = Object.keys(world.up)
    .filter((node) => !world.gone.includes(node))
    .flatMap((node) => {
      const stuck = world.stuck.includes(node);
      return [
        target(node, 9100, 'node', !fresh && !stuck && !world.unscraped.includes(node)),
        target(node, 8080, 'cadvisor', !fresh && !stuck),
      ];
    });
  return json(200, { status: 'success', data: { activeTargets, droppedTargets: [] } });
}

function kumaAnswer() {
  if (world.kuma === 'http500') return json(500, {});
  if (world.kuma === 'refused') throw new TypeError('fetch failed');
  const statusOf = { gitea: 1, radarr: world.radarr === 'up' ? 1 : 0, nasPing: world.nasPing === 'up' ? 1 : 0 };
  const monitorList = [{ id: 1, name: 'gitea' }, { id: 2, name: 'radarr' }, { id: 3, name: 'NAS (Ping)' }];
  return json(200, {
    publicGroupList: [{ monitorList: monitorList.filter((m) => m.id !== 3 || world.nasPing !== 'removed') }],
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
  if (u.startsWith(`${PROM}/api/v1/targets`)) return targetsAnswer();
  if (u.startsWith(`${PROM}/api/v1/status/runtimeinfo`)) {
    return json(200, { status: 'success', data: { startTime: PROM_STARTED, lastConfigTime: PROM_STARTED } });
  }
  if (u.startsWith(PROM)) return promAnswer(decodeURIComponent(u));
  if (u.startsWith(KUMA)) return kumaAnswer();
  throw new Error(`unexpected fetch ${u}`);
};
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

// ── The push side ────────────────────────────────────────────────────────

const caches = { getCached, getCachedInternal, getAllCronStatuses: () => [] };

// A monitor no container has (#390): its uid is on the first node, from its
// name, and it is in the push snapshot whether it is up or down.
const NAS_PING = 'vm103:NAS (Ping)';

// A fresh push pipeline, with no snapshot. Given the `path` of another
// pipeline's snapshot file, it is that pipeline after a restart. Each cycle
// builds the status model and push from it, as refresh.js does (#292).
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
    // The first cycle, every source answering, for a test about what comes
    // after it. It has no snapshot, so each service Kuma has down pages once
    // (#448): checked here, then `sent` starts after it.
    async boot() {
      await this.cycle();
      const down = [['radarr', 'vm103:radarr'], ['nasPing', NAS_PING]]
        .filter(([w]) => world[w] === 'down')
        .map(([, key]) => `service_down ${key}`);
      assert.deepEqual(p.sent, down, 'the first cycle pages what is down, once');
      p.sent.length = 0;
      p.events.length = 0;
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
      await p.boot(); // three reachable hosts, radarr down
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
    await p.boot();
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
    await p.boot();
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
    await p.boot();
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
    await p.boot();
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
    await p.boot();
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
    await p.boot();
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
    await before.boot(); // written: three reachable hosts, radarr down (already paged)
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
    await p.boot();
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

// #461: no snapshot, and the first cycles' sources failing: no baseline to wait
// for. The first cycle is diffed from nothing, its snapshot holds the failed
// source, and what Kuma says pages as on any cycle.
const perCycle = async (p, n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const before = p.sent.length;
    await p.cycle();
    out.push(p.sent.slice(before));
  }
  return out;
};

test('#461: booting with no snapshot into a Prometheus outage: one source_down after 2 cycles, one recovery; radarr down pages once, no host_recovered, nothing re-pages', async () => {
  reset();
  world.prometheus = 'http500';
  const p = pipeline();
  try {
    const during = await perCycle(p, 3);
    assert.equal(p.snapshot.prev().sources.prometheus, 'down');
    assert.deepEqual(p.snapshot.prev().hosts, {}, 'no host was read');

    world.prometheus = 'ok';
    const back = await perCycle(p, 3);
    assert.equal(p.snapshot.prev().hosts.pi.reachable, true);
    assert.deepEqual(
      [...during, ...back],
      [
        ['service_down vm103:radarr'], // Kuma answers: radarr is down, on the first cycle
        ['source_down prometheus'],
        [],
        ['source_recovered prometheus'], // no host_recovered, no second service_down
        [],
        [],
      ]
    );
  } finally {
    p.done();
  }
});

test('#461: booting with no snapshot while only the UPS query fails: a Kuma service going down pages, and its recovery', async () => {
  reset();
  world.radarr = 'up';
  world.rejects = (q) => q.includes('nut_');
  const p = pipeline();
  try {
    const sent = await perCycle(p, 2);
    assert.equal(getCached('ups').ok, false, 'the UPS read fails');
    assert.equal(getCached('services').sources.prometheus.ok, true, 'every node is read');
    world.radarr = 'down';
    sent.push(...(await perCycle(p, 2)));
    world.radarr = 'up';
    sent.push(...(await perCycle(p, 2)));
    assert.deepEqual(sent, [
      [],
      ['source_down prometheus'], // the model's word for a failed UPS query
      ['service_down vm103:radarr'],
      [],
      ['service_recovered vm103:radarr'],
      [],
    ]);
  } finally {
    p.done();
  }
});

// ── #470: no `up` series, told from Prometheus's targets ─────────────────

const NOT_SCRAPED = 'No data: not scraped by Prometheus yet';
const entity = (p, id) => p.status.entities.find((e) => e.id === id);

test('#470: Prometheus restarted after an outage longer than its lookback (targets known, none scraped, no up series) while JagHelm runs: no push', async () => {
  reset();
  const p = pipeline();
  try {
    await p.boot();
    Date.now = () => realNow() + 70_000;
    await p.cycle(); // the containers, seen a minute apart, are established
    const before = targetReads;
    // Back after an outage longer than its lookback, before its first scrape:
    // every query answers, with no series at all (#232's case). Long enough
    // for a container missing from the list to be drawn as gone.
    Date.now = () => realNow() + 200_000;
    world.prometheus = 'fresh';
    await p.cycle();
    await p.cycle();
    await p.cycle();
    const services = getCached('services');
    const presence = Object.values(services.nodes)
      .flatMap((n) => n.services)
      .filter((s) => s.source === 'presence');
    assert.deepEqual(presence, [], 'no grey breadcrumbs: what Prometheus hasn\'t scraped may still run');
    assert.equal(services.sources.prometheus.ok, true, 'Prometheus answered: it is not failing');
    assert.equal(targetReads - before, 3, 'its target list read once a cycle');
    for (const node of ['vm103', 'pi', 'nas']) {
      assert.deepEqual(services.nodes[node].failedReads, [...NODE_READS], `${node}: nothing read`);
      assert.deepEqual(
        [entity(p, `nodes/${node}`).state, entity(p, `nodes/${node}`).word, entity(p, `nodes/${node}`).reason],
        ['unknown', 'No signal', NOT_SCRAPED],
        node
      );
    }
    assert.deepEqual(
      [entity(p, 'services/vm103:postgres').state, entity(p, 'services/vm103:postgres').reason],
      ['unknown', NOT_SCRAPED],
      'a container it ran is kept, as no signal'
    );
    assert.equal(p.status.sources.prometheus.state, 'ok');
    assert.deepEqual(p.snapshot.prev().hosts.pi, {
      reachable: true,
      levels: { cpu: 'ok', disk: 'ok', mem: 'ok' },
    });

    world.prometheus = 'ok';
    const after = targetReads;
    await p.cycle();
    await p.cycle();
    assert.equal(targetReads, after, 'the up series are back: no targets read');
    assert.equal(entity(p, 'nodes/pi').state, 'ok');
    assert.deepEqual(p.sent, [], 'no host_unreachable, no host_recovered, no source push');
  } finally {
    clockBack();
    p.done();
  }
});

test('#470: a node with no up series and no target, while the others are scraped, pages host_unreachable once', async () => {
  reset();
  const p = pipeline();
  try {
    await p.boot();
    // The NAS is gone from Prometheus: no series, no target.
    world.gone = ['nas'];
    const sent = await perCycle(p, 3);
    assert.deepEqual(sent, [['host_unreachable nas'], [], []]);
    const services = getCached('services');
    assert.equal(services.sources.prometheus.ok, true);
    assert.equal(services.nodes.nas.reachable, null);
    assert.deepEqual(services.nodes.nas.failedReads, []);
    assert.deepEqual(
      [entity(p, 'nodes/nas').state, entity(p, 'nodes/nas').reason],
      ['crit', 'Unreachable: no metrics from Prometheus']
    );

    world.gone = [];
    await p.cycle();
    assert.deepEqual(p.sent, ['host_unreachable nas', 'host_recovered nas']);
  } finally {
    p.done();
  }
});

test('#470: the targets read failing pages no node, and the Prometheus source health says why', async () => {
  reset();
  const p = pipeline();
  try {
    await p.boot();
    // A proxy that lets only queries through, while Prometheus has just
    // started: no node has an up series, and its targets can't be read.
    world.prometheus = 'fresh';
    world.targets = 'http403';
    const sent = await perCycle(p, 3);
    const services = getCached('services');
    assert.equal(services.sources.prometheus.ok, true, 'it answered queries: only the unread nodes are held');
    assert.deepEqual(p.status.sources.prometheus.state, 'failed');
    assert.equal(p.status.sources.prometheus.error, 'Prometheus refused the targets read (HTTP 403)');
    for (const node of ['vm103', 'pi', 'nas']) {
      assert.deepEqual(services.nodes[node].failedReads, [...NODE_READS], node);
      assert.equal(entity(p, `nodes/${node}`).state, 'unknown', node);
    }
    // Prometheus failing for 2 cycles is its own push, as for any failed read (#292).
    assert.deepEqual(sent, [[], ['source_down prometheus'], []]);
    assert.equal(
      p.events.find((e) => e.type === 'source_down').body,
      'Prometheus · Prometheus refused the targets read (HTTP 403)'
    );

    // It scrapes: every node has its up series, and no targets read is needed.
    world.prometheus = 'ok';
    await p.cycle();
    assert.deepEqual(p.sent, ['source_down prometheus', 'source_recovered prometheus'], 'no host push');
  } finally {
    p.done();
  }
});

test('#470: the targets read failing holds a gone node unread; it pages once the read answers', async () => {
  reset();
  const p = pipeline();
  try {
    await p.boot();
    world.gone = ['nas'];
    world.targets = 'http403';
    await p.cycle();
    const services = getCached('services');
    assert.equal(services.nodes.pi.reachable, true, 'a node with an up series is read as usual');
    assert.deepEqual(services.nodes.pi.failedReads, []);
    assert.deepEqual(services.nodes.nas.failedReads, [...NODE_READS]);
    assert.equal(entity(p, 'nodes/nas').state, 'unknown');
    assert.equal(p.status.sources.prometheus.error, 'Prometheus refused the targets read (HTTP 403)');
    assert.deepEqual(p.sent, []);

    world.targets = 'ok';
    await p.cycle();
    assert.deepEqual(p.sent, ['host_unreachable nas']);
  } finally {
    p.done();
  }
});

test('#470: Prometheus scraping but storing nothing (a full disk failing its writes) pages once that it is failing, and no host', async () => {
  reset();
  const p = pipeline();
  try {
    await p.boot();
    // Its targets are scraped and healthy, but past its lookback no series is
    // left: no node has an up series or a metric.
    world.prometheus = 'empty';
    const sent = await perCycle(p, 3);
    const services = getCached('services');
    assert.equal(services.sources.prometheus.ok, true, 'it answers: the problem is held per node (#476)');
    assert.equal(p.status.sources.prometheus.state, 'failed');
    assert.equal(p.status.sources.prometheus.error, 'Prometheus scraped VM 103, Pi, NAS but stored no up series');
    for (const node of ['vm103', 'pi', 'nas']) {
      assert.deepEqual(services.nodes[node].failedReads, [...NODE_READS], node);
      assert.equal(entity(p, `nodes/${node}`).state, 'unknown', node);
    }
    assert.deepEqual(sent, [[], ['source_down prometheus'], []], 'one push for the source, none per host');
    assert.equal(
      p.events.find((e) => e.type === 'source_down').body,
      'Prometheus · Prometheus scraped VM 103, Pi, NAS but stored no up series'
    );

    // The disk freed: the series are back.
    world.prometheus = 'ok';
    const back = await perCycle(p, 2);
    assert.deepEqual(back, [['source_recovered prometheus'], []], 'no host_unreachable, no host_recovered');
    assert.equal(entity(p, 'nodes/pi').state, 'ok');
  } finally {
    p.done();
  }
});

test('#470: a reboot where Prometheus scraped vm103\'s cAdvisor before it listened (up 0), and not its node-exporter yet: no push, then healthy with no push', async () => {
  reset();
  world.radarr = 'up';
  world.unscraped = ['vm103'];
  world.up.vm103 = 0;
  const p = pipeline();
  try {
    // JagHelm's first cycle, with no snapshot, as on the reboot.
    await p.cycle();
    let services = getCached('services');
    assert.equal(services.sources.prometheus.ok, true);
    assert.equal(services.nodes.vm103.reachable, false, 'max by (node) (up) is cAdvisor\'s 0');
    assert.deepEqual(services.nodes.vm103.failedReads, [...NODE_READS], 'its node-exporter is not scraped yet: unread');
    assert.deepEqual(
      [entity(p, 'nodes/vm103').state, entity(p, 'nodes/vm103').reason],
      ['unknown', NOT_SCRAPED]
    );
    assert.deepEqual(services.nodes.pi.failedReads, [], 'the other nodes are read as usual');
    assert.deepEqual(p.sent, [], 'no host_unreachable');

    // The next scrape: node-exporter answers, and cAdvisor now listens.
    world.unscraped = [];
    world.up.vm103 = 1;
    const reads = targetReads;
    await p.cycle();
    services = getCached('services');
    assert.equal(targetReads, reads, 'every node has up 1: no targets read');
    assert.equal(entity(p, 'nodes/vm103').state, 'ok');
    assert.deepEqual(p.sent, [], 'no host_recovered');

    // vm103 really goes down: every target of it scraped and down. It pages once.
    world.up.vm103 = 0;
    const down = await perCycle(p, 2);
    assert.deepEqual(down, [['host_unreachable vm103'], []]);
    assert.deepEqual(
      [entity(p, 'nodes/vm103').state, entity(p, 'nodes/vm103').reason],
      ['crit', "Unreachable: Prometheus can't scrape it"]
    );
    world.up.vm103 = 1;
    await p.cycle();
    assert.deepEqual(p.sent, ['host_unreachable vm103', 'host_recovered vm103']);
  } finally {
    p.done();
  }
});

// ── #476: a first scrape that never comes; #477: no target per node ──────

const presenceCards = () =>
  Object.entries(getCached('services').nodes).flatMap(([node, n]) =>
    n.services.filter((c) => c.source === 'presence').map((c) => `${node}:${c.container}`)
  );

test('#476: a node whose targets Prometheus never scrapes: no signal, then one source_down naming them after 3 scrape intervals; a restart sends nothing more; one recovery; the other nodes\' breadcrumbs are drawn meanwhile', async () => {
  reset();
  world.radarr = 'up';
  const base = realNow() + 2 * 3_600_000;
  const at = (k) => {
    Date.now = () => base + k * 30_000; // the refresh loop's 30 s cycles
  };
  const piContainers = CONTAINERS.pi;
  const before = pipeline();
  let p = before;
  try {
    at(0);
    await p.boot();

    // vm103's scrape pool sticks (its targets listed, never scraped: no
    // series), and adguard stops on pi.
    world.stuck = ['vm103'];
    CONTAINERS.pi = [];
    for (const k of [1, 2, 3]) {
      at(k);
      await p.cycle();
      assert.equal(p.status.sources.prometheus.state, 'ok', `cycle ${k}: inside 3 intervals (90 s), Prometheus is fine`);
      assert.deepEqual(
        [entity(p, 'nodes/vm103').state, entity(p, 'nodes/vm103').reason],
        ['unknown', NOT_SCRAPED],
        `cycle ${k}`
      );
    }
    assert.deepEqual(presenceCards(), [], 'while a node waits for its first scrape, no breadcrumb anywhere');

    // 90 s after the first cycle that saw them: a source problem, naming them.
    at(4);
    await p.cycle();
    const named = "Prometheus hasn't scraped VM 103 in 3 scrape intervals";
    assert.equal(getCached('services').sources.prometheus.ok, true, 'Prometheus answers: only vm103 is held');
    assert.deepEqual([p.status.sources.prometheus.state, p.status.sources.prometheus.error], ['failed', named]);
    assert.deepEqual(
      [entity(p, 'nodes/vm103').state, entity(p, 'nodes/vm103').word, entity(p, 'nodes/vm103').reason],
      ['unknown', 'No signal', 'No data: still not scraped by Prometheus'],
      'the node: nobody knows whether it is up'
    );
    assert.deepEqual(
      [entity(p, 'services/vm103:postgres').state, entity(p, 'services/vm103:postgres').reason],
      ['unknown', 'No data: still not scraped by Prometheus'],
      'and what it ran'
    );
    assert.deepEqual(presenceCards(), ['pi:adguard'], "pi's stopped container is drawn; vm103's are held back");
    for (const node of ['pi', 'nas']) assert.equal(entity(p, `nodes/${node}`).state, 'ok', `${node}: read as usual`);
    assert.deepEqual(p.sent, [], 'its first failed cycle');

    at(5);
    await p.cycle();
    assert.deepEqual(p.sent, ['source_down prometheus'], 'one push, for the source: no host_unreachable');
    assert.equal(p.events.at(-1).body, `Prometheus · ${named}`);

    // JagHelm restarts: discovery reads its waits back from the data dir,
    // push its snapshot.
    before.snapshot.flush();
    initDiscovery(PROM);
    p = pipeline({ path: before.path });
    for (const k of [6, 7]) {
      at(k);
      await p.cycle();
      assert.equal(p.status.sources.prometheus.error, named, `cycle ${k}: still counted from before the restart`);
    }
    assert.deepEqual(p.sent, [], 'after the restart: no false recovery, no second page');
    assert.deepEqual(presenceCards(), ['pi:adguard']);

    // The pool unsticks: vm103 is scraped.
    world.stuck = [];
    at(8);
    await p.cycle();
    assert.equal(entity(p, 'nodes/vm103').state, 'ok');
    at(9);
    await p.cycle();
    assert.deepEqual(p.sent, ['source_recovered prometheus'], 'one recovery, and no host push');
    assert.deepEqual(before.sent, ['source_down prometheus']);
  } finally {
    CONTAINERS.pi = piContainers;
    clockBack();
    before.done();
    if (p !== before) p.done();
  }
});

test('#476: a target stuck for hours holds back only its own node: Prometheus still answers, a service and a node removed elsewhere go, and the headline says Prometheus is failing, not unreachable', async () => {
  reset();
  world.radarr = 'up';
  const base = realNow() + 5 * 3_600_000;
  const at = (k) => {
    Date.now = () => base + k * 30_000;
  };
  const p = pipeline();
  try {
    at(0);
    await p.boot();
    world.stuck = ['pi'];
    for (let k = 1; k <= 5; k += 1) {
      at(k);
      await p.cycle();
    }
    assert.deepEqual(p.sent, ['source_down prometheus'], "pi's targets, 3 intervals on: one push");

    // Hours later, still stuck: NAS (Ping) leaves Kuma, and the NAS leaves services.yaml.
    world.nasPing = 'removed';
    saveConfig({ nodes: { vm103: { display_name: 'VM 103' }, pi: { display_name: 'Pi' } }, services: {} });
    for (const k of [480, 481]) {
      at(k);
      await p.cycle();
    }
    const named = "Prometheus hasn't scraped Pi in 3 scrape intervals";
    assert.equal(getCached('services').sources.prometheus.ok, true, 'Prometheus answers: only pi is unread');
    assert.deepEqual([p.status.sources.prometheus.state, p.status.sources.prometheus.error], ['failed', named]);
    assert.doesNotMatch(p.status.overall.sentence, /unreachable/);
    assert.match(p.status.overall.sentence, /^Prometheus failing/);
    assert.deepEqual(
      [entity(p, 'nodes/pi').state, entity(p, 'nodes/pi').reason],
      ['unknown', 'No data: still not scraped by Prometheus'],
      'its node is held'
    );
    assert.equal(entity(p, 'nodes/nas'), undefined, 'a node removed from services.yaml is gone from the model');
    assert.equal(entity(p, `services/${NAS_PING}`), undefined, 'and a monitor removed from Kuma');
    const snap = p.snapshot.prev();
    assert.equal(Object.hasOwn(snap.hosts, 'nas'), false, 'and from the push snapshot');
    assert.equal(Object.hasOwn(snap.services, NAS_PING), false);
    assert.equal(snap.hosts.vm103.reachable, true);
    assert.deepEqual(p.sent, ['source_down prometheus'], 'nothing more is sent');
  } finally {
    saveConfig({
      nodes: { vm103: { display_name: 'VM 103' }, pi: { display_name: 'Pi' }, nas: { display_name: 'NAS' } },
      services: {},
    });
    clockBack();
    p.done();
  }
});

for (const [shape, targets] of [
  ['an empty target list', 'none'],
  ['a target list naming none of the nodes (a federation backend)', 'federated'],
]) {
  test(`#477: ${shape} while every up series is gone: one source_down, no host_unreachable; one recovery`, async () => {
    reset();
    const p = pipeline();
    try {
      await p.boot();
      // A Thanos, Mimir or federating Prometheus loses every series, and has
      // no scrape target per node to tell it by.
      world.targets = targets;
      world.prometheus = 'empty';
      const sent = await perCycle(p, 3);
      assert.deepEqual(sent, [[], ['source_down prometheus'], []], 'one push for the source, none per host');
      const error = 'Prometheus lists no target for any node, and has no up series for VM 103, Pi, NAS';
      assert.deepEqual([p.status.sources.prometheus.state, p.status.sources.prometheus.error], ['failed', error]);
      for (const node of ['vm103', 'pi', 'nas']) {
        assert.deepEqual(
          [entity(p, `nodes/${node}`).state, entity(p, `nodes/${node}`).reason],
          ['unknown', 'No data: no up series, and no target in Prometheus'],
          node
        );
      }

      world.prometheus = 'ok';
      const back = await perCycle(p, 2);
      assert.deepEqual(back, [['source_recovered prometheus'], []], 'no host_recovered');
    } finally {
      p.done();
    }
  });
}

test('#477: a target list naming some of the nodes keeps reading per node: a node with no target pages host_unreachable once, Prometheus fine', async () => {
  reset();
  const p = pipeline();
  try {
    await p.boot();
    world.gone = ['nas']; // no series, no target; vm103's and pi's are listed
    const sent = await perCycle(p, 2);
    assert.deepEqual(sent, [['host_unreachable nas'], []]);
    assert.equal(p.status.sources.prometheus.state, 'ok');
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
      await p.boot(); // radarr down per Kuma, its container running
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

test('a monitor no container has: Kuma failing and recovering while it is down sends no recovery; its real one is sent', async () => {
  reset();
  const p = pipeline();
  try {
    await p.boot(); // NAS (Ping) up
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
    await p.boot(); // NAS (Ping) up
    assert.equal(p.snapshot.prev().services[NAS_PING], 'up');
    const app = express();
    app.use('/api/services', servicesRoutes);
    const r = await request(app).get('/api/services');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['beats', 'nodes', 'overallHealth', 'sources']);
    const { beats, ...board } = r.body;
    assert.equal(
      JSON.stringify(board).includes('NAS (Ping)'),
      false,
      'up, the monitor draws no card: it is nowhere on the board'
    );
    // Only its heartbeat strip (#312) names it: the model's row for it draws one.
    assert.ok(beats[NAS_PING], 'its strip, by its uid');
  } finally {
    p.done();
  }
});

test('a monitor no container has: upWithoutCard is kept beside the cached payload, at no level inside it', async () => {
  reset();
  const p = pipeline();
  try {
    await p.boot(); // NAS (Ping) up
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
    await p.boot(); // gitea and radarr have their monitors; NAS (Ping) is up with no container
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
    await before.boot(); // NAS (Ping) up
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
    await p.boot();
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
    assert.equal(
      after.sources.prometheus.error,
      failure === 'http500' ? 'Prometheus answered with an error (HTTP 500)' : "Prometheus didn't answer in time"
    );
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
    // A bare "fetch failed", with no cause to read: it didn't answer (#605).
    assert.equal(after.sources.kuma.error, "Kuma didn't answer");
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
  // Its cause, which the model says in words (#605).
  assert.deepEqual(getCachedInternal('services').sourceErrors.prometheus, { cause: 'http', status: 500 });
  assert.equal(getCachedInternal('services').sourceErrors.kuma, null);
});
