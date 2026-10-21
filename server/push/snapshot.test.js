/**
 * The push snapshot is built from the status model (#292): the builders read
 * the model's entities, and what the model can't call up or down holds its
 * last state. The tests run the real model where a snapshot is built from
 * caches (snapshotAfter), and hand-made entities where a builder is tested
 * alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCron,
  buildHosts,
  buildMonitorOf,
  buildServices,
  buildSnapshot,
  buildSources,
  buildUps,
  heldLevels,
  heldSinceOf,
  normalizeUpsStatus,
  serviceStateOf,
  upgradeSnapshot,
} from './snapshot.js';
import { NODE_READS } from '../discovery.js';
import { DEFAULT_THRESHOLDS } from '../status/thresholds.js';
import { cachesOf, snapshotAfter } from '../testing/pushPipeline.js';
import {
  NOW,
  card,
  cronNode,
  cronRun,
  missing,
  monitored,
  node,
  UPS_ONLINE,
} from '../testing/statusFixtures.js';

const T = DEFAULT_THRESHOLDS;
const statusOf = (...entities) => ({ entities });

// ── services ─────────────────────────────────────────────────────────────

test('serviceStateOf: crit is down, ok is up, everything else holds (null)', () => {
  const rows = [
    [{ state: 'crit', word: 'Down' }, 'down'],
    [{ state: 'ok', word: 'Up' }, 'up'],
    // Kuma retrying a check: first cycle ok (or held), then warn. Push holds (#292).
    [{ state: 'ok', word: 'Pending' }, null],
    [{ state: 'warn', word: 'Pending' }, null],
    [{ state: 'maintenance', word: 'Maintenance' }, null],
    [{ state: 'unknown', word: 'No signal' }, null],
    [null, null],
  ];
  for (const [entity, want] of rows)
    assert.equal(serviceStateOf(entity), want, JSON.stringify(entity));
});

const service = (uid, state, word) => ({ id: `services/${uid}`, kind: 'service', state, word });

test("buildServices: the model's services as up or down, sorted; a container with no monitor is not in it", () => {
  const out = buildServices(
    statusOf(
      service('vm103:zoo', 'ok', 'Up'),
      service('vm103:abc', 'crit', 'Down'),
      { id: 'services/pi2:ntp', kind: 'container', state: 'ok', word: 'Running' },
      { id: 'nodes/pi2', kind: 'node', state: 'ok' }
    )
  );
  assert.deepEqual(out, { 'vm103:abc': 'down', 'vm103:zoo': 'up' });
  assert.deepEqual(Object.keys(out), ['vm103:abc', 'vm103:zoo']);
});

test('buildServices: pending, maintenance and no signal hold the last known state (#292)', () => {
  const status = statusOf(
    service('n1:a', 'warn', 'Pending'),
    service('n1:b', 'ok', 'Pending'),
    service('n1:c', 'maintenance', 'Maintenance'),
    service('n1:d', 'unknown', 'No signal'),
    service('n1:e', 'warn', 'Pending')
  );
  const prev = { services: { 'n1:a': 'down', 'n1:b': 'up', 'n1:c': 'down', 'n1:d': 'up' } };
  assert.deepEqual(buildServices(status, { prev }), {
    'n1:a': 'down',
    'n1:b': 'up',
    'n1:c': 'down',
    'n1:d': 'up',
    'n1:e': 'unknown', // never known
  });
});

test("buildServices: a held key holds its monitor's state when the monitor's key moved (#395)", () => {
  // Down on n1:x last cycle; pending now on n1:y, its new key.
  const prev = { services: { 'n1:x': 'down' }, monitorOf: { 'n1:x': '1' } };
  assert.deepEqual(
    buildServices(statusOf(service('n1:y', 'warn', 'Pending')), {
      prev,
      monitorOf: { 'n1:y': '1' },
    }),
    {
      'n1:y': 'down',
    }
  );
});

test('buildServices: an up monitor no card is drawn for reads as up; a grey breadcrumb with its uid does not hide it (#390)', () => {
  const status = statusOf(
    service('vm103:NAS (Ping)', 'ok', 'Up'),
    service('vm103:grafana', 'crit', 'Down'),
    { id: 'services/vm103:nas-ui', kind: 'container', state: 'crit', word: 'Missing' }
  );
  assert.deepEqual(
    buildServices(status, { upWithoutCard: ['vm103:NAS (Ping)', 'vm103:nas-ui', 'vm103:grafana'] }),
    {
      'vm103:grafana': 'down', // the card, not the entry
      'vm103:NAS (Ping)': 'up',
      'vm103:nas-ui': 'up', // the entry, not the grey breadcrumb
    }
  );
  assert.deepEqual(buildServices(statusOf(), { upWithoutCard: 'junk' }), {}, 'no list');
  assert.deepEqual(buildServices(null), {}, 'no model');
});

test('buildMonitorOf: the keys of services only, ids as strings, sorted; junk is dropped', () => {
  const services = { 'vm103:b': 'up', 'vm103:a': 'down', 'pi:c': 'up' };
  assert.deepEqual(
    buildMonitorOf({ 'vm103:b': 2, 'vm103:a': '1', 'vm103:gone': 3, 'pi:c': null }, services),
    { 'vm103:a': '1', 'vm103:b': '2' }
  );
  assert.deepEqual(Object.keys(buildMonitorOf({ 'vm103:b': 2, 'vm103:a': 1 }, services)), [
    'vm103:a',
    'vm103:b',
  ]);
  for (const junk of [
    undefined,
    null,
    'x',
    ['vm103:a'],
    { 'vm103:a': '' },
    { 'vm103:a': NaN },
    { 'vm103:a': {} },
  ]) {
    assert.deepEqual(buildMonitorOf(junk, services), {}, JSON.stringify(junk));
  }
});

// ── hosts ────────────────────────────────────────────────────────────────

const nodeEntity = (key, extra) => ({
  id: `nodes/${key}`,
  kind: 'node',
  name: key,
  node: key,
  ...extra,
});

test("buildHosts: each node's levels are the model's conditions, sorted", () => {
  const out = buildHosts(
    statusOf(
      nodeEntity('vm103', {
        state: 'warn',
        word: 'Warning',
        conditions: { mem: 'ok', disk: 'warn', cpu: 'ok', temp: 'ok' },
      }),
      nodeEntity('pi2', {
        state: 'crit',
        word: 'Critical',
        conditions: { 'pool:tank': 'crit', disk: 'ok' },
      })
    )
  );
  assert.deepEqual(out, {
    pi2: { reachable: true, levels: { disk: 'ok', 'pool:tank': 'crit' } },
    vm103: { reachable: true, levels: { cpu: 'ok', disk: 'warn', mem: 'ok', temp: 'ok' } },
  });
  assert.deepEqual(Object.keys(out), ['pi2', 'vm103']);
});

test('buildHosts: a reading the model could not read holds its level; an unreachable node keeps them all', () => {
  const prev = {
    a: { reachable: true, levels: { cpu: 'warn', disk: 'warn', temp: 'ok' } },
    b: { reachable: true, levels: { disk: 'crit' } },
  };
  const out = buildHosts(
    statusOf(
      // The CPU query failed; there is no temperature reading this cycle.
      nodeEntity('a', { state: 'unknown', conditions: { cpu: 'unknown', disk: 'ok' } }),
      nodeEntity('b', { state: 'crit', word: 'Unreachable', conditions: {} })
    ),
    prev
  );
  assert.deepEqual(out, {
    a: { reachable: true, levels: { cpu: 'warn', disk: 'ok', temp: 'ok' } },
    b: { reachable: false, levels: { disk: 'crit' } },
  });
});

test('buildHosts: a node with no data (its up read failed, or kept while Prometheus fails) holds its entry, or is left out', () => {
  const prev = { a: { reachable: true, levels: { disk: 'warn' } } };
  const noData = (key) =>
    nodeEntity(key, {
      state: 'unknown',
      word: 'No signal',
      reason: 'No data: Prometheus unreachable',
    });
  assert.deepEqual(buildHosts(statusOf(noData('a'), noData('new')), prev), { a: prev.a });
  // A crit node that is not unreachable is over a line.
  const over = buildHosts(
    statusOf(nodeEntity('a', { state: 'crit', word: 'Critical', conditions: { disk: 'crit' } }))
  );
  assert.equal(over.a.reachable, true);
});

test("buildHosts: a storage pool leaves only when its node's pools were read without it (#468)", () => {
  const prev = {
    a: { reachable: true, levels: { disk: 'ok', 'pool:gone': 'warn', 'pool:kept': 'ok' } },
  };
  const judged = statusOf(
    nodeEntity('a', { state: 'ok', conditions: { disk: 'ok', 'pool:kept': 'ok' } })
  );
  const reads = (read) => (node) =>
    node === 'a' ? { pools: [{ name: 'kept', percent: 40 }], read } : { pools: [], read: false };
  assert.deepEqual(buildHosts(judged, prev, reads(true)).a.levels, {
    disk: 'ok',
    'pool:kept': 'ok',
  });
  // Not read (a fetch failed), or no pool reads given (no payload): held.
  assert.deepEqual(buildHosts(judged, prev, reads(false)).a.levels, prev.a.levels);
  assert.deepEqual(buildHosts(judged, prev).a.levels, prev.a.levels);
  // The model didn't judge its readings this cycle (no data, or unreachable): held, read or not.
  const noData = statusOf(nodeEntity('a', { state: 'unknown', word: 'No signal' }));
  assert.deepEqual(buildHosts(noData, prev, reads(true)).a, prev.a);
  const away = statusOf(nodeEntity('a', { state: 'crit', word: 'Unreachable', conditions: {} }));
  assert.deepEqual(buildHosts(away, prev, reads(true)).a.levels, prev.a.levels);
});

// #469: a hold lasts 24 h from its first cycle, then the reading leaves.
const DAY = 24 * 60 * 60 * 1000;

test('buildHosts: a reading kept with no level read this cycle carries when its hold began, and leaves at 24 h (#469)', () => {
  // The CPU query failed (unknown); the temperature, held at ok, has no condition.
  const judged = statusOf(
    nodeEntity('a', { state: 'unknown', conditions: { cpu: 'unknown', disk: 'ok' } })
  );
  const prev = { a: { reachable: true, levels: { cpu: 'warn', disk: 'warn', temp: 'ok' } } };
  const first = buildHosts(judged, prev, undefined, NOW);
  assert.deepEqual(first.a, {
    reachable: true,
    levels: { cpu: 'warn', disk: 'ok', temp: 'ok' },
    heldSince: { cpu: NOW, temp: NOW },
  });
  assert.deepEqual(buildHosts(judged, first, undefined, NOW + DAY - 1).a, first.a, 'kept');
  assert.deepEqual(
    buildHosts(judged, first, undefined, NOW + DAY).a,
    { reachable: true, levels: { disk: 'ok' } },
    'at 24 h both leave, and when they began with them'
  );
  // Read again, a reading has no hold.
  const read = statusOf(
    nodeEntity('a', { state: 'ok', conditions: { cpu: 'ok', disk: 'ok', temp: 'ok' } })
  );
  assert.deepEqual(buildHosts(read, first, undefined, NOW + 1).a, {
    reachable: true,
    levels: { cpu: 'ok', disk: 'ok', temp: 'ok' },
  });
  // A pool that ends (#468) takes its start with it.
  const pools = { a: { reachable: true, levels: { 'pool:x': 'warn' }, heldSince: { 'pool:x': NOW } } };
  const calm = statusOf(nodeEntity('a', { state: 'ok', conditions: {} }));
  assert.deepEqual(
    buildHosts(calm, pools, () => ({ pools: [], read: true }), NOW + 1).a,
    { reachable: true, levels: {} }
  );
});

test('buildHosts: a hold with no start (a snapshot written before #469, or a damaged one) starts now; an unreachable or no-data node keeps its holds as they are (#469)', () => {
  const judged = statusOf(
    nodeEntity('a', { state: 'warn', conditions: { disk: 'ok', temp: 'unknown' } })
  );
  const old = { a: { reachable: true, levels: { disk: 'ok', temp: 'warn' } } };
  assert.deepEqual(buildHosts(judged, old, undefined, NOW + 5 * DAY).a, {
    ...old.a,
    heldSince: { temp: NOW + 5 * DAY },
  });
  const junk = { a: { ...old.a, heldSince: { temp: 'yesterday', disk: NOW } } };
  assert.deepEqual(buildHosts(judged, junk, undefined, NOW).a.heldSince, { temp: NOW });
  // With no clock nothing is timed (and a start a previous cycle gave is kept).
  assert.deepEqual(buildHosts(judged, old).a, old.a);

  const held = {
    a: { reachable: true, levels: { disk: 'ok', temp: 'warn' }, heldSince: { temp: NOW } },
  };
  const away = statusOf(nodeEntity('a', { state: 'crit', word: 'Unreachable', conditions: {} }));
  assert.deepEqual(buildHosts(away, held, undefined, NOW + 2 * DAY).a, {
    ...held.a,
    reachable: false,
  });
  const noData = statusOf(nodeEntity('a', { state: 'unknown', word: 'No signal' }));
  assert.deepEqual(buildHosts(noData, held, undefined, NOW + 2 * DAY).a, held.a);
});

test("heldSinceOf: when each held reading's hold began, by node; anything but a time, or for no level, is left out (#469)", () => {
  const snap = {
    hosts: {
      a: {
        reachable: true,
        levels: { temp: 'warn', disk: 'ok', cpu: 'ok' },
        heldSince: { temp: NOW, disk: 'x', gone: NOW },
      },
      b: { reachable: true, levels: { temp: 'ok' } },
      c: 'junk',
    },
  };
  assert.deepEqual(heldSinceOf(snap), { a: { temp: NOW } });
  assert.deepEqual(heldSinceOf(null), {});
});

// ── the UPS, cron, sources ───────────────────────────────────────────────

test('buildUps: crit is on battery, ok online, anything else holds; no UPS in the model is null', () => {
  const ups = (state) => statusOf({ id: 'power/ups', kind: 'ups', state });
  assert.deepEqual(buildUps(ups('crit')), { state: 'on_battery' });
  assert.deepEqual(buildUps(ups('ok')), { state: 'online' });
  assert.deepEqual(buildUps(ups('unknown'), { state: 'on_battery' }), { state: 'on_battery' });
  assert.deepEqual(buildUps(ups('unknown')), { state: 'unknown' });
  assert.equal(buildUps(statusOf()), null);
});

test("buildCron: each job and backup by the model's state and word; anything else holds", () => {
  const job = (key, state, word, kind = 'job') => ({ id: `${kind}s/${key}`, kind, state, word });
  const out = buildCron(
    statusOf(
      job('vm103:sync', 'warn', 'Failed'),
      job('vm103:backup', 'ok', 'OK'),
      job('pi2:prune', 'warn', 'Overdue'),
      job('nas:b2', 'crit', 'Failed', 'backup'),
      job('pi2:odd', 'unknown', 'No signal'),
      job('pi2:new', 'unknown', 'No signal')
    ),
    { 'pi2:odd': 'failure' }
  );
  assert.deepEqual(out, {
    'nas:b2': 'failure',
    'pi2:new': 'unknown',
    'pi2:odd': 'failure',
    'pi2:prune': 'overdue',
    'vm103:backup': 'success',
    'vm103:sync': 'failure',
  });
  assert.deepEqual(Object.keys(out), [
    'nas:b2',
    'pi2:new',
    'pi2:odd',
    'pi2:prune',
    'vm103:backup',
    'vm103:sync',
  ]);
});

test("buildSources: failing on a source's first failed cycle, down from its second, ok when it answers", () => {
  const listed = (sources) => ({ entities: [], sources });
  const failed = { state: 'failed', error: 'boom' };
  let s = buildSources(listed({ prometheus: { state: 'ok' }, kuma: failed }));
  assert.deepEqual(s, { kuma: 'failing', prometheus: 'ok' });
  s = buildSources(listed({ prometheus: failed, kuma: failed, nut: { state: 'ok' } }), s);
  assert.deepEqual(s, { kuma: 'down', nut: 'ok', prometheus: 'failing' });
  s = buildSources(listed({ prometheus: { state: 'ok' }, kuma: failed, nut: { state: 'ok' } }), s);
  assert.deepEqual(s, { kuma: 'down', nut: 'ok', prometheus: 'ok' });
  // Not listed this cycle (no services payload): kept. Gitea never pages.
  assert.deepEqual(buildSources(listed({ gitea: failed }), s), s);
});

// ── the whole snapshot, from caches through the real model ───────────────

const HEALTHY_SOURCES = { prometheus: { ok: true }, kuma: { ok: true } };

test('buildSnapshot: composes all six maps from the model of the cached payloads', () => {
  const caches = cachesOf({
    services: {
      sources: HEALTHY_SOURCES,
      nodes: {
        vm103: node(
          { cpu: '20.0', memPercent: '30.0', diskPercent: '92.0' },
          {
            services: [
              monitored('vm103:db', 'up'),
              monitored('vm103:web', 'down'),
              card('vm103:alloy'),
            ],
          }
        ),
      },
    },
    internal: { upWithoutCard: [], monitorOf: { 'vm103:web': 4, 'vm103:db': 5 } },
    ups: { ...UPS_ONLINE, status: 2 },
    cron: [cronNode('vm103', { backup: cronRun('failure') })],
  });
  const { snapshot } = snapshotAfter(caches);
  assert.deepEqual(snapshot, {
    services: { 'vm103:db': 'up', 'vm103:web': 'down' },
    monitorOf: { 'vm103:db': '5', 'vm103:web': '4' },
    hosts: {
      vm103: { reachable: true, levels: { cpu: 'ok', disk: 'warn', mem: 'ok', temp: 'ok' } },
    },
    ups: { state: 'on_battery' },
    cron: { 'vm103:backup': 'failure' },
    sources: { kuma: 'ok', nut: 'ok', prometheus: 'ok' },
  });
  assert.deepEqual(Object.keys(snapshot), [
    'services',
    'monitorOf',
    'hosts',
    'ups',
    'cron',
    'sources',
  ]);
});

// What the refreshes cache when every source answered with nothing to report:
// no nodes configured, no UPS.
const EMPTY_SERVICES = { nodes: {}, overallHealth: 'unknown' };
const NO_UPS = {
  status: null,
  charge: null,
  runtime: null,
  load: null,
  ok: true,
  configured: false,
  model: null,
};

test('LAW: sources answering with nothing yield a well-formed baseline snapshot', () => {
  const { snapshot } = snapshotAfter(cachesOf({ services: EMPTY_SERVICES, ups: NO_UPS, cron: [] }));
  assert.deepEqual(snapshot, {
    services: {},
    monitorOf: {},
    hosts: {},
    ups: { state: 'unknown' },
    cron: {},
    sources: {},
  });
});

test('LAW: the snapshot is byte-identical however the payloads order nodes, cards and jobs', () => {
  const mk = (rev) => {
    const order = (list) => (rev ? [...list].reverse() : list);
    const nodes = Object.fromEntries(
      order([
        [
          'alpha',
          node(
            { diskPercent: '96' },
            { services: order([monitored('alpha:s2', 'down'), monitored('alpha:s1', 'up')]) }
          ),
        ],
        ['beta', node({}, { services: [monitored('beta:s1', 'up')] })],
      ])
    );
    return cachesOf({
      services: { sources: HEALTHY_SOURCES, nodes },
      ups: UPS_ONLINE,
      cron: [
        cronNode(
          'alpha',
          Object.fromEntries(
            order([
              ['b', cronRun('success')],
              ['a', cronRun('failure')],
            ])
          )
        ),
      ],
    });
  };
  assert.equal(
    JSON.stringify(snapshotAfter(mk(false)).snapshot),
    JSON.stringify(snapshotAfter(mk(true)).snapshot)
  );
});

test("buildSnapshot: a job's overdue comes from the model's clock", () => {
  const run = cronRun('success', 60_000, { expected_every_seconds: 3600 });
  const caches = cachesOf({
    services: EMPTY_SERVICES,
    ups: NO_UPS,
    cron: [cronNode('n', { j: run })],
  });
  assert.equal(snapshotAfter(caches).snapshot.cron['n:j'], 'success');
  assert.equal(
    snapshotAfter(caches, null, { now: NOW + 3 * 3600_000 }).snapshot.cron['n:j'],
    'overdue'
  );
});

// ── #232: a source that failed this cycle keeps its previous state ──────────

const PREV = {
  services: { 'vm103:gitea': 'up', 'vm103:radarr': 'down', 'vm103:postgres': 'up' },
  monitorOf: {},
  hosts: {
    pi: { reachable: true, levels: { cpu: 'ok', disk: 'ok', mem: 'ok' } },
    vm103: { reachable: true, levels: { cpu: 'ok', disk: 'warn', mem: 'ok' } },
  },
  ups: { state: 'online' },
  cron: { 'vm103:backup': 'success' },
  sources: {},
};

// This cycle's caches: what a failed Prometheus looks like (every node lost its
// metrics and containers), Kuma still reports radarr down and gitea now down too.
function failedCycle({ prometheus = true, kuma = true, ups = true }) {
  const failedReads = prometheus ? [] : NODE_READS;
  const metrics = prometheus ? { cpu: '50.0', memPercent: '60.0', diskPercent: '70.0' } : {};
  return cachesOf({
    services: {
      sources: { prometheus: { ok: prometheus }, kuma: { ok: kuma } },
      nodes: {
        pi: node(metrics, { reachable: prometheus ? true : null, failedReads, services: [] }),
        vm103: node(metrics, {
          reachable: prometheus ? true : null,
          failedReads,
          services: [monitored('vm103:radarr', 'down'), monitored('vm103:gitea', 'down')],
        }),
      },
    },
    ups: ups ? NO_UPS : { status: null, ok: false, configured: null },
    cron: [cronNode('vm103', { backup: cronRun('failure') })],
  });
}
const after = (caches, prev) => snapshotAfter(caches, prev).snapshot;

test('buildSnapshot: Prometheus failed -> hosts held, missing services kept, present ones current', () => {
  const snap = after(failedCycle({ prometheus: false }), PREV);
  assert.deepEqual(snap.hosts, PREV.hosts);
  assert.deepEqual(snap.services, {
    'vm103:gitea': 'down', // Kuma still answers: this cycle's status
    'vm103:postgres': 'up', // not seen this cycle: kept
    'vm103:radarr': 'down',
  });
  assert.deepEqual(snap.ups, { state: 'unknown' }, 'the UPS read answered, with no UPS');
  assert.deepEqual(snap.cron, { 'vm103:backup': 'failure' }, 'cron is never held');
  assert.deepEqual(snap.sources, { kuma: 'ok', prometheus: 'failing' });
});

test('buildSnapshot: Kuma failed -> every service kept, hosts current', () => {
  const snap = after(failedCycle({ kuma: false }), PREV);
  assert.deepEqual(snap.services, PREV.services);
  assert.deepEqual(
    snap.hosts.vm103,
    { reachable: true, levels: { cpu: 'ok', disk: 'ok', mem: 'ok', temp: 'ok' } },
    'read this cycle'
  );
  assert.deepEqual(snap.sources, { kuma: 'failing', prometheus: 'ok' });
});

test('buildSnapshot: the UPS read failed -> the UPS state kept', () => {
  assert.deepEqual(after(failedCycle({ ups: false }), PREV).ups, { state: 'online' });
});

test("buildSnapshot: every source ok -> only what the model can't call is taken from prev", () => {
  const caches = failedCycle({});
  const fresh = after(caches, null);
  const held = after(caches, PREV);
  assert.deepEqual(held.services, fresh.services);
  assert.deepEqual(held.ups, fresh.ups);
  assert.deepEqual(held.cron, fresh.cron);
  assert.deepEqual(held.hosts.pi, fresh.hosts.pi);
});

test('#461: buildSnapshot: no prev -> a snapshot whatever the sources say; a failed source is in it, what it feeds is not', () => {
  const promDown = after(failedCycle({ prometheus: false }), null);
  assert.deepEqual(promDown, {
    services: { 'vm103:gitea': 'down', 'vm103:radarr': 'down' }, // Kuma answers
    monitorOf: {},
    hosts: {}, // every host unread
    ups: { state: 'unknown' },
    cron: { 'vm103:backup': 'failure' },
    sources: { kuma: 'ok', prometheus: 'failing' },
  });

  const upsDown = after(failedCycle({ ups: false }), null);
  assert.deepEqual(upsDown.ups, { state: 'unknown' }, 'the UPS unread');
  assert.deepEqual(
    upsDown.sources,
    { kuma: 'ok', prometheus: 'failing' },
    'the model reads it as Prometheus failing'
  );
  assert.deepEqual(Object.keys(upsDown.hosts), ['pi', 'vm103'], 'every host read');

  const allDown = after(failedCycle({ prometheus: false, kuma: false, ups: false }), null);
  assert.deepEqual(allDown.hosts, {});
  assert.deepEqual(allDown.sources, { kuma: 'failing', prometheus: 'failing' });
  assert.deepEqual(allDown.cron, { 'vm103:backup': 'failure' }, 'cron has no upstream to fail');
});

test('buildSnapshot: no prev -> a Kuma failure, or a Prometheus failure a host was read through, gives a snapshot too', () => {
  const kumaDown = after(failedCycle({ kuma: false }), null);
  assert.deepEqual(
    kumaDown.services,
    { 'vm103:gitea': 'unknown', 'vm103:radarr': 'unknown' },
    'no signal from Kuma'
  );

  const caches = cachesOf({
    services: {
      sources: { prometheus: { ok: false }, kuma: { ok: true } },
      nodes: {
        nas: node({}, { reachable: null, failedReads: NODE_READS, metrics: {} }),
        pi: node({}, { reachable: true, failedReads: ['temp'] }),
      },
    },
    ups: NO_UPS,
  });
  const snap = after(caches, null);
  assert.deepEqual(Object.keys(snap.hosts), ['pi'], 'nas has no data: not in the snapshot');
  assert.equal(snap.hosts.pi.reachable, true);
});

test('buildSnapshot: a missing services or UPS cache (cold, or expired) is a failed source, not an empty one', () => {
  const cold = cachesOf({ services: null, ups: null, cron: [] });
  const snap = after(cold, PREV);
  assert.deepEqual(snap.services, PREV.services);
  assert.deepEqual(snap.hosts, PREV.hosts);
  assert.deepEqual(snap.ups, PREV.ups);
  assert.deepEqual(
    after(cold, null),
    { services: {}, monitorOf: {}, hosts: {}, ups: { state: 'unknown' }, cron: {}, sources: {} },
    'with no prev, nothing is read from them (#461)'
  );
  assert.deepEqual(after(cachesOf({ services: EMPTY_SERVICES, ups: null }), PREV).ups, PREV.ups);
});

// ── #232 review: a failed query holds only what it feeds ─────────────────────

// Prometheus failed this cycle; each node says which of its reads failed.
function partialCycle(nodes) {
  return cachesOf({
    services: { sources: { prometheus: { ok: false }, kuma: { ok: true } }, nodes },
    ups: NO_UPS,
  });
}
const READ = { cpu: '50.0', memPercent: '95.0', diskPercent: '70.0' };

test('buildSnapshot: another node failing a metric query does not hold a host whose up answered 0', () => {
  const snap = after(
    partialCycle({
      nas: node(READ, { failedReads: ['temp'] }),
      pi: node(READ, { reachable: false }),
      vm103: node(READ),
    }),
    PREV
  );
  assert.equal(snap.hosts.pi.reachable, false, 'pi is read, so it is unreachable');
  assert.deepEqual(snap.hosts.vm103, {
    reachable: true,
    levels: { cpu: 'ok', disk: 'ok', mem: 'warn', temp: 'ok' },
  });
  assert.deepEqual(
    snap.hosts.nas,
    { reachable: true, levels: { cpu: 'ok', disk: 'ok', mem: 'warn' } },
    'a new host is taken as read'
  );
});

test('buildSnapshot: a failed metric query holds that level only; a failed up query holds the host', () => {
  const prev = {
    ...PREV,
    hosts: {
      ...PREV.hosts,
      pi: { reachable: true, levels: { cpu: 'warn', disk: 'ok', mem: 'ok' } },
    },
  };
  const snap = after(
    partialCycle({
      pi: node({ ...READ, cpu: '10' }, { failedReads: ['cpu', 'disk'] }),
      vm103: node(READ, { reachable: null, failedReads: ['reachable'] }),
    }),
    prev
  );
  assert.deepEqual(snap.hosts.pi, {
    reachable: true,
    levels: { cpu: 'warn', disk: 'ok', mem: 'warn', temp: 'ok' },
    // Held from this cycle, for at most 24 h (#469).
    heldSince: { cpu: NOW, disk: NOW },
  });
  assert.deepEqual(snap.hosts.vm103, PREV.hosts.vm103);
});

test('buildSnapshot: a host judged by metric presence holds when a metric query failed', () => {
  const snap = after(
    partialCycle({
      pi: node(
        { cpu: null, memPercent: null, diskPercent: null },
        { reachable: null, failedReads: ['cpu', 'disk', 'mem'] }
      ),
      vm103: node(
        { cpu: null, memPercent: null, diskPercent: null, temp: null },
        { reachable: null }
      ),
    }),
    PREV
  );
  assert.deepEqual(snap.hosts.pi, PREV.hosts.pi);
  assert.equal(
    snap.hosts.vm103.reachable,
    false,
    'every query answered: no metrics is unreachable'
  );
});

test('buildSnapshot: a host missing from the payload is kept while Prometheus fails, dropped when it answers', () => {
  const nodes = { pi: node(READ) };
  assert.deepEqual(Object.keys(after(partialCycle(nodes), PREV).hosts), ['pi', 'vm103']);
  assert.deepEqual(after(partialCycle(nodes), PREV).hosts.vm103, PREV.hosts.vm103);
  const answered = cachesOf({ services: { sources: HEALTHY_SOURCES, nodes }, ups: NO_UPS });
  assert.deepEqual(
    Object.keys(after(answered, PREV).hosts),
    ['pi'],
    'a node removed from the config'
  );
});

test('buildSnapshot: a payload without source flags counts as answered', () => {
  const caches = cachesOf({ services: { nodes: {} }, ups: UPS_ONLINE, cron: [] });
  assert.deepEqual(after(caches, PREV).services, {});
  assert.deepEqual(after(caches, PREV).hosts, {});
});

// ── #395: the monitor that fed each service key ──────────────────────────────

test('buildSnapshot: monitorOf comes from beside the cached payload, for the keys of this snapshot', () => {
  const { snapshot } = snapshotAfter(
    cachesOf({
      services: {
        sources: HEALTHY_SOURCES,
        nodes: {
          vm103: node({}, { services: [monitored('vm103:grafana', 'down'), card('vm103:redis')] }),
        },
      },
      ups: NO_UPS,
      internal: {
        upWithoutCard: ['vm103:NAS UI'],
        monitorOf: { 'vm103:grafana': 7, 'vm103:NAS UI': 11 },
      },
    })
  );
  assert.deepEqual(snapshot.services, { 'vm103:grafana': 'down', 'vm103:NAS UI': 'up' });
  assert.deepEqual(snapshot.monitorOf, { 'vm103:grafana': '7', 'vm103:NAS UI': '11' });
});

const PREV_OWNED = { ...PREV, monitorOf: { 'vm103:gitea': '1', 'vm103:radarr': '2' } };
const owned = (opts, monitorOf) => {
  const caches = failedCycle(opts);
  return { ...caches, getCachedInternal: () => ({ upWithoutCard: [], monitorOf }) };
};

test('buildSnapshot: Kuma failed -> the monitor of every key is kept with it', () => {
  const snap = after(owned({ kuma: false }, { 'vm103:gitea': 9 }), PREV_OWNED);
  assert.deepEqual(snap.monitorOf, PREV_OWNED.monitorOf);
  // A snapshot written before #395 has none to keep.
  assert.deepEqual(after(owned({ kuma: false }, { 'vm103:gitea': 9 }), PREV).monitorOf, {});
});

test("buildSnapshot: Prometheus failed -> a kept key keeps its monitor, a present one has this cycle's", () => {
  const prev = { ...PREV_OWNED, monitorOf: { ...PREV_OWNED.monitorOf, 'vm103:postgres': '3' } };
  const snap = after(owned({ prometheus: false }, { 'vm103:radarr': 2 }), prev);
  assert.deepEqual(
    snap.monitorOf,
    {
      'vm103:postgres': '3', // not seen this cycle: kept, with its monitor
      'vm103:radarr': '2', // present: this cycle's
    },
    'vm103:gitea is present with no monitor this cycle'
  );
});

// ── #361: the levels a snapshot holds seed the model at boot ─────────────────

test("heldLevels: a snapshot's levels by node", () => {
  const snap = {
    hosts: {
      a: { reachable: true, levels: { disk: 'warn', cpu: 'ok' } },
      b: { reachable: false, levels: {} },
    },
  };
  assert.deepEqual(heldLevels(snap, T), { a: { cpu: 'ok', disk: 'warn' }, b: {} });
  assert.deepEqual(heldLevels(null, T), {});
  assert.deepEqual(heldLevels({ hosts: 'junk' }, T), {});
});

test('heldLevels: only level words survive from a damaged file', () => {
  const snap = {
    hosts: { a: { reachable: true, levels: { disk: 'warn', cpu: {}, mem: 3, temp: 'hot' } } },
  };
  assert.deepEqual(heldLevels(snap, T), { a: { disk: 'warn' } });
});

test('upgradeSnapshot: a snapshot written before #292 gets levels for its readings; anything else is as it was', () => {
  const old = {
    services: { 'n1:app': 'down' },
    hosts: {
      n1: { reachable: true, cpu: 0.2, mem: 0.95, disk: 0.6 },
      n2: { reachable: false, cpu: 0, mem: 0, disk: 0 },
    },
    ups: { state: 'online' },
    cron: {},
  };
  assert.deepEqual(upgradeSnapshot(old, T), {
    ...old,
    hosts: {
      n1: { reachable: true, levels: { cpu: 'ok', disk: 'ok', mem: 'warn' } },
      n2: { reachable: false, levels: { cpu: 'ok', disk: 'ok', mem: 'ok' } },
    },
  });
  const current = { ...old, hosts: { n1: { reachable: true, levels: { cpu: 'warn' } } } };
  assert.equal(upgradeSnapshot(current, T), current, 'a current snapshot is returned as it is');
  assert.equal(upgradeSnapshot(null, T), null);
});

test("heldLevels: a snapshot written before #292 holds readings: at or over a line is that line's level", () => {
  const snap = {
    hosts: {
      a: { reachable: true, cpu: 0.9, mem: 0.89, disk: 0.96 },
      b: { reachable: false, cpu: 0, mem: 0, disk: 0 },
    },
  };
  assert.deepEqual(heldLevels(snap, T), {
    a: { cpu: 'warn', mem: 'ok', disk: 'crit' },
    b: { cpu: 'ok', mem: 'ok', disk: 'ok' },
  });
});

test('buildSnapshot is pure: the same inputs twice give byte-identical snapshots', () => {
  const caches = failedCycle({});
  const { status } = snapshotAfter(caches, PREV);
  assert.equal(
    JSON.stringify(buildSnapshot(caches, PREV, status)),
    JSON.stringify(buildSnapshot(caches, PREV, status))
  );
});

test("a missing card that backs a monitor, while the monitor is up, is the monitor's up entry to push (#390)", () => {
  // The model judges the breadcrumb (a warning, NAS UI being up, #438); push reads the up entry.
  const { snapshot, status } = snapshotAfter(
    cachesOf({
      services: {
        sources: HEALTHY_SOURCES,
        nodes: { vm103: node({}, { services: [missing('vm103:nas-ui')] }) },
      },
      internal: {
        upWithoutCard: ['vm103:nas-ui'],
        monitorOf: { 'vm103:nas-ui': 1 },
        backedBy: { 'vm103:nas-ui': { monitor: 'NAS UI', status: 'up' } },
      },
      ups: NO_UPS,
    })
  );
  const breadcrumb = status.entities.find((e) => e.id === 'services/vm103:nas-ui');
  assert.deepEqual([breadcrumb.kind, breadcrumb.state], ['container', 'warn']);
  assert.deepEqual(snapshot.services, { 'vm103:nas-ui': 'up' });
});

test('push reads the jobs from the model, not the cron store: one read of cron-jobs.json a cycle (#292)', () => {
  const caches = failedCycle({});
  const { status } = snapshotAfter(caches);
  const noStore = {
    ...caches,
    getAllCronStatuses: () => {
      throw new Error('push read the cron store');
    },
  };
  assert.deepEqual(buildSnapshot(noStore, null, status).cron, { 'vm103:backup': 'failure' });
});

test("normalizeUpsStatus: how push reads nut_status, through the model (the Android app's parity test holds its copy to it)", () => {
  // 0 = Unknown, 1 = Online (OL), 2 = On Battery (OB), 3 = Low Battery (LB, folded into on_battery).
  assert.deepEqual([0, 1, 2, 3].map(normalizeUpsStatus), [
    'unknown',
    'online',
    'on_battery',
    'on_battery',
  ]);
  for (const junk of [
    -1,
    4,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    null,
    undefined,
    'garbage',
  ]) {
    assert.equal(normalizeUpsStatus(junk), 'unknown', String(junk));
  }
});
