import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeServiceStatus,
  normalizeCronStatus,
  normalizeUpsStatus,
  coerceFraction,
  buildServices,
  buildCron,
  buildHosts,
  buildUps,
  buildSnapshot,
} from './snapshot.js';
import { NODE_READS } from '../discovery.js';

test('normalizeServiceStatus: up/down recognized, everything else unknown', () => {
  assert.equal(normalizeServiceStatus('up'), 'up');
  assert.equal(normalizeServiceStatus('down'), 'down');
  assert.equal(normalizeServiceStatus('UP'), 'up'); // case-insensitive
  assert.equal(normalizeServiceStatus('running'), 'unknown');
  assert.equal(normalizeServiceStatus('unknown'), 'unknown');
  assert.equal(normalizeServiceStatus(null), 'unknown');
  assert.equal(normalizeServiceStatus(undefined), 'unknown');
  assert.equal(normalizeServiceStatus(''), 'unknown');
});

test('normalizeCronStatus: success/failure recognized, else unknown', () => {
  assert.equal(normalizeCronStatus('success'), 'success');
  assert.equal(normalizeCronStatus('failure'), 'failure');
  assert.equal(normalizeCronStatus('FAILURE'), 'failure');
  assert.equal(normalizeCronStatus('pending'), 'unknown');
  assert.equal(normalizeCronStatus(null), 'unknown');
  assert.equal(normalizeCronStatus(undefined), 'unknown');
});

test('normalizeUpsStatus: numeric nut_status mapped, else unknown', () => {
  // Canonical NUT decode (matches src/components/Widgets.jsx:22):
  // 0=Unknown, 1=Online (OL), 2=On Battery (OB), 3=Low Battery (LB).
  assert.equal(normalizeUpsStatus(1), 'online'); // OL
  assert.equal(normalizeUpsStatus(2), 'on_battery'); // OB
  assert.equal(normalizeUpsStatus(0), 'unknown'); // Unknown
  assert.equal(normalizeUpsStatus(3), 'on_battery'); // Low Battery folds into on_battery
  assert.equal(normalizeUpsStatus('online'), 'online'); // string passthrough
  assert.equal(normalizeUpsStatus('on_battery'), 'on_battery');
  assert.equal(normalizeUpsStatus(7), 'unknown'); // unrecognized code
  assert.equal(normalizeUpsStatus(null), 'unknown');
  assert.equal(normalizeUpsStatus(undefined), 'unknown');
  assert.equal(normalizeUpsStatus('garbage'), 'unknown');
});

test('coerceFraction: percent-string 0..100 -> 0..1 fraction, clamped, junk -> 0', () => {
  assert.equal(coerceFraction('45.6'), 0.456);
  assert.equal(coerceFraction('100'), 1);
  assert.equal(coerceFraction('0'), 0);
  assert.equal(coerceFraction(90), 0.9); // bare number percent
  assert.equal(coerceFraction(null), 0);
  assert.equal(coerceFraction(undefined), 0);
  assert.equal(coerceFraction('NaN'), 0);
  assert.equal(coerceFraction('150'), 1); // clamp high
  assert.equal(coerceFraction('-5'), 0); // clamp low
});

// ── Task 2: buildServices + buildCron ────────────────────────────────────────

test('buildServices: flattens nodes->services to NODE:ID map, sorted, normalized', () => {
  const cache = {
    nodes: {
      vm103: {
        services: [
          { uid: 'vm103:zoo', status: 'up' },
          { uid: 'vm103:abc', status: 'down' },
        ],
      },
      pi2: {
        services: [{ uid: 'pi2:ntp', status: 'running' }], // unrecognized -> unknown
      },
    },
  };
  const out = buildServices(cache);
  assert.deepEqual(out, {
    'pi2:ntp': 'unknown',
    'vm103:abc': 'down',
    'vm103:zoo': 'up',
  });
  // canonical ascending key order
  assert.deepEqual(Object.keys(out), ['pi2:ntp', 'vm103:abc', 'vm103:zoo']);
});

test('buildServices: missing/empty cache -> empty map', () => {
  assert.deepEqual(buildServices(null), {});
  assert.deepEqual(buildServices({}), {});
  assert.deepEqual(buildServices({ nodes: {} }), {});
  assert.deepEqual(buildServices({ nodes: { pi: {} } }), {});
});

test('buildServices: the up monitors no card is drawn for read as up; a card with their uid wins, a breadcrumb does not (#390)', () => {
  const cache = {
    nodes: {
      vm103: {
        services: [
          { uid: 'vm103:nas-ui', status: 'unknown', source: 'presence' },
          { uid: 'vm103:grafana', status: 'down', source: 'monitor' },
          { uid: 'vm103:gitea', status: 'up' },
        ],
      },
    },
  };
  assert.deepEqual(buildServices(cache, ['vm103:NAS (Ping)', 'vm103:nas-ui', 'vm103:grafana']), {
    'vm103:gitea': 'up',
    'vm103:grafana': 'down', // the card, not the entry
    'vm103:NAS (Ping)': 'up',
    'vm103:nas-ui': 'up', // the entry, not the grey breadcrumb
  });
  assert.deepEqual(buildServices({ nodes: {} }, 'junk'), {}, 'no list');
  assert.deepEqual(buildServices({ nodes: {}, upWithoutCard: ['vm103:x'] }), {}, 'the served payload has none');
});

test('buildServices: byte-identical regardless of insertion order', () => {
  const a = { nodes: { pi: { services: [{ uid: 'pi:b', status: 'up' }, { uid: 'pi:a', status: 'down' }] } } };
  const b = { nodes: { pi: { services: [{ uid: 'pi:a', status: 'down' }, { uid: 'pi:b', status: 'up' }] } } };
  assert.equal(JSON.stringify(buildServices(a)), JSON.stringify(buildServices(b)));
});

test('buildCron: latest run per NODE:JOB, sorted, normalized', () => {
  const statuses = [
    {
      node: 'vm103',
      jobs: [
        { job: 'sync', runs: [{ status: 'failure' }, { status: 'success' }] }, // latest = failure
        { job: 'backup', runs: [{ status: 'success' }] },
      ],
    },
    { node: 'pi2', jobs: [{ job: 'prune', runs: [{ status: 'weird' }] }] }, // -> unknown
  ];
  const out = buildCron(statuses);
  assert.deepEqual(out, {
    'pi2:prune': 'unknown',
    'vm103:backup': 'success',
    'vm103:sync': 'failure',
  });
  assert.deepEqual(Object.keys(out), ['pi2:prune', 'vm103:backup', 'vm103:sync']);
});

test('buildCron: empty runs / empty input -> unknown or empty map', () => {
  assert.deepEqual(buildCron([]), {});
  assert.deepEqual(buildCron(null), {});
  assert.deepEqual(buildCron([{ node: 'pi', jobs: [{ job: 'j', runs: [] }] }]), { 'pi:j': 'unknown' });
});

// ── Task 3: buildHosts + buildUps ────────────────────────────────────────────

test('buildHosts: percent-string metrics -> 0..1 fractions, reachable, sorted', () => {
  const cache = {
    nodes: {
      vm103: { metrics: { cpu: '12.0', memPercent: '45.0', diskPercent: '78.0' } },
      pi2: { metrics: { cpu: '90.0', memPercent: '90.0', diskPercent: '5.0' } },
    },
  };
  const out = buildHosts(cache);
  assert.deepEqual(out, {
    pi2: { reachable: true, cpu: 0.9, mem: 0.9, disk: 0.05 },
    vm103: { reachable: true, cpu: 0.12, mem: 0.45, disk: 0.78 },
  });
  assert.deepEqual(Object.keys(out), ['pi2', 'vm103']);
});

test('buildHosts: all-null metrics -> reachable:false, zeroed; partial -> reachable:true', () => {
  const cache = {
    nodes: {
      dead: { metrics: { cpu: null, memPercent: null, diskPercent: null } },
      half: { metrics: { cpu: '50.0', memPercent: null, diskPercent: null } },
      bare: {}, // no metrics key at all
    },
  };
  const out = buildHosts(cache);
  assert.deepEqual(out.dead, { reachable: false, cpu: 0, mem: 0, disk: 0 });
  assert.deepEqual(out.half, { reachable: true, cpu: 0.5, mem: 0, disk: 0 });
  assert.deepEqual(out.bare, { reachable: false, cpu: 0, mem: 0, disk: 0 });
});

test('buildHosts: the payload reachable (Prometheus up) wins over metric presence (#232)', () => {
  const cache = {
    nodes: {
      // every target down, but the CPU irate still has a value for a few minutes
      gone: { reachable: false, metrics: { cpu: '12.0', memPercent: null, diskPercent: null } },
      // an exporter-less host Prometheus still scrapes something on
      bare: { reachable: true, metrics: { cpu: null, memPercent: null, diskPercent: null } },
      // no up series carries this node's label: fall back to the metrics
      unlabelled: { reachable: null, metrics: { cpu: '5.0', memPercent: null, diskPercent: null } },
    },
  };
  const out = buildHosts(cache);
  assert.equal(out.gone.reachable, false);
  assert.equal(out.bare.reachable, true);
  assert.equal(out.unlabelled.reachable, true);
});

test('buildHosts: missing cache -> empty map', () => {
  assert.deepEqual(buildHosts(null), {});
  assert.deepEqual(buildHosts({ nodes: {} }), {});
});

test('buildUps: numeric status mapped to state; missing -> unknown', () => {
  assert.deepEqual(buildUps({ status: 1 }), { state: 'online' });       // OL
  assert.deepEqual(buildUps({ status: 2 }), { state: 'on_battery' });   // OB
  assert.deepEqual(buildUps({ status: 0 }), { state: 'unknown' });      // Unknown
  // LB (3) folds into on_battery per the normalization law (must not drop urgent power event)
  assert.deepEqual(buildUps({ status: 3 }), { state: 'on_battery' });   // Low Battery -> on_battery
  assert.deepEqual(buildUps({ status: 9 }), { state: 'unknown' });
  assert.deepEqual(buildUps({ status: null }), { state: 'unknown' });
  assert.deepEqual(buildUps(null), { state: 'unknown' });
  assert.deepEqual(buildUps({}), { state: 'unknown' });
});

// ── Task 4: buildSnapshot (composed PURE snapshot via injectable seam) ───────

function fakeCaches({ services, ups, cron }) {
  return {
    getCached: (key) => (key === 'services' ? services : key === 'ups' ? ups : null),
    getAllCronStatuses: () => cron ?? [],
  };
}

test('buildSnapshot: composes all four sub-maps from injected caches', () => {
  const caches = fakeCaches({
    services: {
      nodes: {
        vm103: {
          metrics: { cpu: '20.0', memPercent: '30.0', diskPercent: '40.0' },
          services: [{ uid: 'vm103:db', status: 'up' }, { uid: 'vm103:web', status: 'down' }],
        },
      },
    },
    ups: { status: 2 }, // 2 = On Battery (OB) per the NUT decode
    cron: [{ node: 'vm103', jobs: [{ job: 'backup', runs: [{ status: 'failure' }] }] }],
  });
  const snap = buildSnapshot(caches);
  assert.deepEqual(snap, {
    services: { 'vm103:db': 'up', 'vm103:web': 'down' },
    hosts: { vm103: { reachable: true, cpu: 0.2, mem: 0.3, disk: 0.4 } },
    ups: { state: 'on_battery' },
    cron: { 'vm103:backup': 'failure' },
  });
});

// What the refreshes cache when every source answered with nothing to report:
// no nodes configured, no UPS.
const EMPTY_SERVICES = { nodes: {}, overallHealth: 'unknown' };
const NO_UPS = { status: null, charge: null, runtime: null, load: null, ok: true };

test('buildSnapshot: top-level keys are exactly the four, in fixed order', () => {
  const snap = buildSnapshot(fakeCaches({ services: EMPTY_SERVICES, ups: NO_UPS, cron: [] }));
  assert.deepEqual(Object.keys(snap), ['services', 'hosts', 'ups', 'cron']);
  assert.deepEqual(snap, {
    services: {},
    hosts: {},
    ups: { state: 'unknown' },
    cron: {},
  });
});

test('buildSnapshot: PURE — same input twice is byte-identical', () => {
  const caches = fakeCaches({
    services: { nodes: { b: { services: [{ uid: 'b:y', status: 'up' }] }, a: { services: [{ uid: 'a:x', status: 'down' }] } } },
    ups: { status: 1 }, // 1 = Online (OL)
    cron: [{ node: 'b', jobs: [{ job: 'j', runs: [{ status: 'success' }] }] }],
  });
  assert.equal(JSON.stringify(buildSnapshot(caches)), JSON.stringify(buildSnapshot(caches)));
});

// ── Task 5: Determinism + normalization-law guard tests ──────────────────────

test('LAW: top-level snapshot is byte-identical under reordered node/service/cron insertion', () => {
  const mk = (order) => fakeCaches({
    services: {
      nodes: order === 'fwd'
        ? { alpha: { metrics: { cpu: '10.0', memPercent: '10.0', diskPercent: '10.0' }, services: [{ uid: 'alpha:s2', status: 'down' }, { uid: 'alpha:s1', status: 'up' }] },
            beta: { metrics: { cpu: '20.0', memPercent: '20.0', diskPercent: '20.0' }, services: [{ uid: 'beta:s1', status: 'up' }] } }
        : { beta: { metrics: { cpu: '20.0', memPercent: '20.0', diskPercent: '20.0' }, services: [{ uid: 'beta:s1', status: 'up' }] },
            alpha: { metrics: { cpu: '10.0', memPercent: '10.0', diskPercent: '10.0' }, services: [{ uid: 'alpha:s1', status: 'up' }, { uid: 'alpha:s2', status: 'down' }] } },
    },
    ups: { status: 1 }, // Online (OL)
    cron: order === 'fwd'
      ? [{ node: 'alpha', jobs: [{ job: 'b', runs: [{ status: 'success' }] }, { job: 'a', runs: [{ status: 'failure' }] }] }]
      : [{ node: 'alpha', jobs: [{ job: 'a', runs: [{ status: 'failure' }] }, { job: 'b', runs: [{ status: 'success' }] }] }],
  });
  assert.equal(JSON.stringify(buildSnapshot(mk('fwd'))), JSON.stringify(buildSnapshot(mk('rev'))));
});

test('LAW: every unrecognized value collapses to unknown / reachable:false', () => {
  const snap = buildSnapshot(fakeCaches({
    services: {
      nodes: {
        ghost: { metrics: { cpu: 'NaN', memPercent: null, diskPercent: undefined },
                 services: [{ uid: 'ghost:x', status: 'flapping' }] },
      },
    },
    ups: { status: 'bogus' },
    cron: [{ node: 'ghost', jobs: [{ job: 'j', runs: [{ status: 'maybe' }] }] }],
  }));
  assert.equal(snap.services['ghost:x'], 'unknown');
  assert.equal(snap.cron['ghost:j'], 'unknown');
  assert.equal(snap.ups.state, 'unknown');
  assert.deepEqual(snap.hosts.ghost, { reachable: false, cpu: 0, mem: 0, disk: 0 });
});

test('LAW: sources answering with nothing yield a well-formed baseline snapshot', () => {
  const snap = buildSnapshot(fakeCaches({ services: EMPTY_SERVICES, ups: NO_UPS, cron: null }));
  assert.deepEqual(snap, { services: {}, hosts: {}, ups: { state: 'unknown' }, cron: {} });
});

// ── cron overdue ─────────────────────────────────────────────────────────────

const OVERDUE_RUN = {
  status: 'success',
  timestamp: '2026-01-01T00:00:00Z',
  expected_every_seconds: 3600,
};
const OVERDUE_NOW = Date.parse('2026-01-01T00:00:00Z') + (3600 + 900) * 1000 + 1000;

test('buildCron: overdue latest run + now => "overdue"', () => {
  const cron = [{ node: 'n', jobs: [{ job: 'j', runs: [OVERDUE_RUN] }] }];
  assert.deepEqual(buildCron(cron, OVERDUE_NOW), { 'n:j': 'overdue' });
});

test('buildCron: same run without now (or within grace) stays "success"', () => {
  const cron = [{ node: 'n', jobs: [{ job: 'j', runs: [OVERDUE_RUN] }] }];
  assert.deepEqual(buildCron(cron, null), { 'n:j': 'success' });
  assert.deepEqual(buildCron(cron), { 'n:j': 'success' });
  assert.deepEqual(buildCron(cron, Date.parse(OVERDUE_RUN.timestamp) + 1000), { 'n:j': 'success' });
});

test('buildSnapshot: clock enters only via caches.now', () => {
  const base = fakeCaches({
    services: EMPTY_SERVICES,
    ups: NO_UPS,
    cron: [{ node: 'n', jobs: [{ job: 'j', runs: [OVERDUE_RUN] }] }],
  });
  assert.equal(buildSnapshot(base).cron['n:j'], 'success');
  assert.equal(buildSnapshot({ ...base, now: () => OVERDUE_NOW }).cron['n:j'], 'overdue');
});

// ── #232: a source that failed this cycle keeps its previous state ──────────

const PREV = {
  services: { 'vm103:gitea': 'up', 'vm103:radarr': 'down', 'vm103:postgres': 'up' },
  hosts: {
    pi: { reachable: true, cpu: 0.1, mem: 0.2, disk: 0.3 },
    vm103: { reachable: true, cpu: 0.4, mem: 0.5, disk: 0.6 },
  },
  ups: { state: 'online' },
  cron: { 'vm103:backup': 'success' },
};

const METRICS = { cpu: '50.0', memPercent: '60.0', diskPercent: '70.0' };

// This cycle's caches: every node lost its metrics and containers (what a failed
// Prometheus looks like), Kuma still reports radarr down and gitea now down too.
function failedCycle({ prometheus = true, kuma = true, ups = true }) {
  return fakeCaches({
    services: {
      sources: { prometheus: { ok: prometheus }, kuma: { ok: kuma } },
      nodes: {
        pi: { reachable: null, metrics: {}, services: [] },
        vm103: {
          reachable: null,
          metrics: {},
          services: [
            { uid: 'vm103:radarr', status: 'down' },
            { uid: 'vm103:gitea', status: 'down' },
          ],
        },
      },
    },
    ups: { status: null, ok: ups },
    cron: [{ node: 'vm103', jobs: [{ job: 'backup', runs: [{ status: 'failure' }] }] }],
  });
}

test('buildSnapshot: Prometheus failed -> hosts kept, missing services kept, present ones current', () => {
  const snap = buildSnapshot(failedCycle({ prometheus: false }), PREV);
  assert.deepEqual(snap.hosts, PREV.hosts);
  assert.deepEqual(snap.services, {
    'vm103:gitea': 'down', // Kuma still answers: this cycle's status
    'vm103:postgres': 'up', // not seen this cycle: kept
    'vm103:radarr': 'down',
  });
  assert.deepEqual(Object.keys(snap.services), ['vm103:gitea', 'vm103:postgres', 'vm103:radarr']);
  assert.deepEqual(snap.ups, { state: 'unknown' }, 'the UPS read answered (ok), with no UPS');
  assert.deepEqual(snap.cron, { 'vm103:backup': 'failure' }, 'cron is never held');
});

test('buildSnapshot: Kuma failed -> every service kept, hosts current', () => {
  const caches = failedCycle({ kuma: false });
  const snap = buildSnapshot(caches, PREV);
  assert.deepEqual(snap.services, PREV.services);
  assert.deepEqual(snap.hosts, buildHosts(caches.getCached('services')));
});

test('buildSnapshot: the UPS read failed -> the UPS state kept', () => {
  assert.deepEqual(buildSnapshot(failedCycle({ ups: false }), PREV).ups, { state: 'online' });
});

test('buildSnapshot: every source ok -> nothing is taken from prev', () => {
  const caches = failedCycle({});
  assert.deepEqual(buildSnapshot(caches, PREV), buildSnapshot(caches));
});

test('buildSnapshot: no prev -> no baseline while Prometheus fails with no host read, or the UPS read fails', () => {
  assert.equal(buildSnapshot(failedCycle({ prometheus: false }), null), null, 'every host unread');
  assert.equal(buildSnapshot(failedCycle({ ups: false }), null), null, 'the UPS unread');
  assert.equal(buildSnapshot(failedCycle({ prometheus: false, kuma: false, ups: false }), null), null);
});

test('buildSnapshot: no prev -> a Kuma failure, or a Prometheus failure a host was read through, is still a baseline', () => {
  // Either can last as long as JagHelm runs (no Kuma at KUMA_URL; a query that
  // always times out), and waiting would leave push without a baseline.
  const kumaDown = buildSnapshot(failedCycle({ kuma: false }), null);
  assert.deepEqual(kumaDown.services, { 'vm103:gitea': 'down', 'vm103:radarr': 'down' });

  const caches = fakeCaches({
    services: {
      sources: { prometheus: { ok: false }, kuma: { ok: true } },
      nodes: {
        nas: { reachable: null, failedReads: NODE_READS, metrics: {}, services: [] },
        pi: { reachable: true, failedReads: ['temp'], metrics: METRICS, services: [] },
      },
    },
    ups: NO_UPS,
  });
  const snap = buildSnapshot(caches, null);
  assert.deepEqual(Object.keys(snap.hosts), ['nas', 'pi']);
  assert.equal(snap.hosts.pi.reachable, true);
});

test('buildSnapshot: a missing services or UPS cache (cold, or expired) is a failed source, not an empty one', () => {
  const cold = fakeCaches({ services: null, ups: null, cron: [] });
  const snap = buildSnapshot(cold, PREV);
  assert.deepEqual(snap.services, PREV.services);
  assert.deepEqual(snap.hosts, PREV.hosts);
  assert.deepEqual(snap.ups, PREV.ups);
  assert.equal(buildSnapshot(cold, null), null, 'and never a baseline');
  assert.deepEqual(buildSnapshot(fakeCaches({ services: EMPTY_SERVICES, ups: null }), PREV).ups, PREV.ups);
});

// ── #232 review: a failed query holds only what it feeds ─────────────────────

// Prometheus failed this cycle; each node says which of its reads failed.
function partialCycle(nodes) {
  return fakeCaches({
    services: { sources: { prometheus: { ok: false }, kuma: { ok: true } }, nodes },
    ups: NO_UPS,
  });
}

test('buildSnapshot: another node failing a metric query does not hold a host whose up answered 0', () => {
  const snap = buildSnapshot(
    partialCycle({
      nas: { reachable: true, failedReads: ['temp'], metrics: METRICS, services: [] },
      pi: { reachable: false, failedReads: [], metrics: METRICS, services: [] },
      vm103: { reachable: true, failedReads: [], metrics: METRICS, services: [] },
    }),
    PREV
  );
  assert.equal(snap.hosts.pi.reachable, false, 'pi is read, so it is unreachable');
  assert.deepEqual(snap.hosts.vm103, { reachable: true, cpu: 0.5, mem: 0.6, disk: 0.7 });
  assert.deepEqual(snap.hosts.nas, { reachable: true, cpu: 0.5, mem: 0.6, disk: 0.7 }, 'a new host is taken as read');
});

test('buildSnapshot: a failed metric query holds that metric only; a failed up query holds reachable', () => {
  const snap = buildSnapshot(
    partialCycle({
      pi: { reachable: false, failedReads: ['cpu', 'disk'], metrics: METRICS, services: [] },
      vm103: { reachable: null, failedReads: ['reachable'], metrics: METRICS, services: [] },
    }),
    PREV
  );
  assert.deepEqual(snap.hosts.pi, { reachable: false, cpu: 0.1, mem: 0.6, disk: 0.3 });
  assert.deepEqual(snap.hosts.vm103, { reachable: true, cpu: 0.5, mem: 0.6, disk: 0.7 });
});

test('buildSnapshot: a host judged by metric presence holds reachable when a metric query failed', () => {
  const snap = buildSnapshot(
    partialCycle({
      pi: { reachable: null, failedReads: ['cpu', 'disk', 'mem'], metrics: {}, services: [] },
      vm103: { reachable: null, failedReads: [], metrics: {}, services: [] },
    }),
    PREV
  );
  assert.deepEqual(snap.hosts.pi, PREV.hosts.pi);
  assert.equal(snap.hosts.vm103.reachable, false, 'every query answered: no metrics is unreachable');
});

test('buildSnapshot: a host missing from the payload is kept while Prometheus fails, dropped when it answers', () => {
  const nodes = { pi: { reachable: true, failedReads: [], metrics: METRICS, services: [] } };
  assert.deepEqual(Object.keys(buildSnapshot(partialCycle(nodes), PREV).hosts), ['pi', 'vm103']);
  assert.deepEqual(buildSnapshot(partialCycle(nodes), PREV).hosts.vm103, PREV.hosts.vm103);
  const answered = fakeCaches({ services: { sources: { prometheus: { ok: true }, kuma: { ok: true } }, nodes }, ups: NO_UPS });
  assert.deepEqual(Object.keys(buildSnapshot(answered, PREV).hosts), ['pi'], 'a node removed from the config');
});

test('buildSnapshot: a payload without source flags counts as answered', () => {
  const caches = fakeCaches({ services: { nodes: {} }, ups: { status: 1 }, cron: [] });
  assert.deepEqual(buildSnapshot(caches, PREV), buildSnapshot(caches));
});
