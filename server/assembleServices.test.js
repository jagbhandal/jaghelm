// server/assembleServices.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { assembleServices } from './refresh.js';
import { createContainerRegistry } from './containerRegistry.js';
import { createServiceRegistry } from './serviceRegistry.js';
import { diffSnapshots } from './push/differ.js';
import { cachesOfAssembled, snapshotAfter } from './testing/pushPipeline.js';

// The push snapshot of one assembled cycle, built from the status model of what
// the services refresh caches (#292), after `prev`; and what push sends from
// one cycle to the next.
const pushSnap = (r, prev = null) => snapshotAfter(cachesOfAssembled(r), prev).snapshot;
const servicesOf = (r) => pushSnap(r).services;
function pushes(prev, next) {
  const before = pushSnap(prev);
  const { snapshot, status } = snapshotAfter(cachesOfAssembled(next), before);
  return diffSnapshots(before, snapshot, status).map((e) => `${e.type} ${e.id}`);
}


const nodeCfg = { display_name: 'Production' };
function nodeData(containers) { return { metrics: {}, containers }; }

// A fake container registry: no-op record, returns a fixed missing list.
function fakeRegistry(missing = []) {
  return { recordSeen() {}, getMissing() { return missing; } };
}

function run({ nodeResults, monitors, lastSeen = {}, lastSeenContainer = {}, containerRegistry = null, now = () => 0, config = { services: {} }, presenceKnown }) {
  return assembleServices({
    nodeResults,
    monitors,
    config,
    lastSeenNodeOf: (id) => lastSeen[String(id)] ?? null,
    lastSeenContainerOf: (id) => lastSeenContainer[String(id)] ?? null,
    containerRegistry,
    now,
    presenceKnown,
  });
}

// ---- base down-synthesis (Task 3 of the base plan) ----

test('assemble: a down monitor with no running container becomes a synthesised red card on its last-seen node', () => {
  const { nodes } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: { cpu: 1 } }])]],
    monitors: {
      1: { id: 1, name: 'gitea', status: 'up', ping: 5, uptime24: 1, active: true },
      2: { id: 2, name: 'grafana', status: 'down', ping: 0, uptime24: 0.5, active: true },
    },
    lastSeen: { 2: 'vm103' },
  });
  const svcs = nodes.vm103.services;
  const grafana = svcs.find((s) => s.container === 'grafana');
  assert.ok(grafana, 'synthesised grafana card exists');
  assert.equal(grafana.status, 'down');
  assert.equal(grafana.monitored, true);
  assert.equal(grafana.docker, null);
  assert.equal(grafana.uid, 'vm103:grafana');
  assert.equal(grafana.source, 'monitor');
  assert.equal(svcs[0].status, 'down');           // down-first ordering
});

test('assemble: a down monitor matched to a RUNNING container is NOT double-counted', () => {
  const { nodes } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'grafana', status: 'running', docker: { cpu: 2 } }])]],
    monitors: { 1: { id: 1, name: 'grafana', status: 'down', ping: 0, uptime24: 0, active: true } },
  });
  const grafanas = nodes.vm103.services.filter((s) => s.container === 'grafana');
  assert.equal(grafanas.length, 1);
  assert.equal(grafanas[0].status, 'down');        // Kuma overlay paints it down
  assert.equal(grafanas[0].monitored, true);
  assert.deepEqual(grafanas[0].docker, { cpu: 2 }); // keeps container stats
});

test('assemble: a PAUSED (inactive) down monitor is hidden — the down-vs-inactive invariant', () => {
  const { nodes } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: {
      1: { id: 1, name: 'gitea', status: 'up', active: true },
      2: { id: 2, name: 'retired', status: 'down', active: false },
    },
    lastSeen: { 2: 'vm103' },
  });
  assert.equal(nodes.vm103.services.some((s) => s.container === 'retired'), false);
});

test('assemble: with no last-seen record, a down monitor falls back to the first node', () => {
  const { nodes } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: {
      1: { id: 1, name: 'gitea', status: 'up', active: true },
      2: { id: 2, name: 'orphan', status: 'down', active: true },
    },
    lastSeen: {},
  });
  assert.ok(nodes.vm103.services.some((s) => s.container === 'orphan' && s.status === 'down'));
});

test('assemble: seen[] reports matched (monitorId, node, container) triples for the registry', () => {
  const { seen } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'up', active: true } },
  });
  assert.deepEqual(seen, [{ monitorId: 1, nodeKey: 'vm103', container: 'gitea' }]);
});

// ---- recovery-push uid stability (the "no recovered push" bug) ----

test('assemble: a down synth card reuses the remembered CONTAINER uid, not the monitor name', () => {
  // Monitor "Radarr" was matched to container "radarr" while up; the container
  // has now vanished and only the down monitor remains. The synth card must key
  // off the remembered container ("radarr"), NOT the monitor name ("Radarr") —
  // otherwise the down card and the later recovered card live under different
  // uids and the push differ never sees a down→up transition.
  const { nodes } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([])]], // container gone
    monitors: { 7: { id: 7, name: 'Radarr', status: 'down', active: true } },
    lastSeen: { 7: 'vm103' },
    lastSeenContainer: { 7: 'radarr' },
  });
  const card = nodes.vm103.services.find((s) => s.status === 'down');
  assert.ok(card, 'synth down card exists');
  assert.equal(card.uid, 'vm103:radarr');   // container uid, NOT vm103:Radarr
  assert.equal(card.container, 'radarr');
});

test('recovery push: vanish→down then return→up emits service_recovered on a stable uid', () => {
  // DOWN cycle: container gone, down monitor remembered as container "radarr".
  const down = run({
    nodeResults: [['vm103', nodeCfg, nodeData([])]],
    monitors: { 7: { id: 7, name: 'Radarr', status: 'down', active: true } },
    lastSeen: { 7: 'vm103' },
    lastSeenContainer: { 7: 'radarr' },
  });
  // UP cycle: container back, monitor up (matched → no synth).
  const up = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'radarr', status: 'running', docker: {} }])]],
    monitors: { 7: { id: 7, name: 'Radarr', status: 'up', active: true } },
  });
  const snapDown = pushSnap(down);
  const snapUp = pushSnap(up, snapDown);
  assert.equal(snapDown.services['vm103:radarr'], 'down');
  assert.equal(snapUp.services['vm103:radarr'], 'up');
  const events = diffSnapshots(snapDown, snapUp);
  const rec = events.find((e) => e.type === 'service_recovered');
  assert.ok(rec, 'service_recovered fires for the returned service');
  assert.equal(rec.id, 'vm103:radarr');
});

// ---- breadcrumb synthesis (this plan) ----

test('assemble: an established, unmonitored, vanished container becomes a grey presence breadcrumb', () => {
  const { nodes, breadcrumbCount } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'up', active: true } },
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
    ]),
  });
  const pg = nodes.vm103.services.find((s) => s.container === 'postgres');
  assert.ok(pg, 'breadcrumb card exists');
  assert.equal(pg.status, 'unknown');
  assert.equal(pg.monitored, false);
  assert.equal(pg.source, 'presence');
  assert.equal(pg.lastSeenAt, 1000);
  assert.equal(pg.icon, null);
  assert.equal(pg.ping, null);
  assert.equal(pg.uptime24, null);
  assert.equal(pg.docker, null);
  assert.equal(pg.integration, null);
  assert.equal(pg.uid, 'vm103:postgres');
  assert.equal(breadcrumbCount, 1);
});

// A stopped container holds its monitor only while the monitor is down (#240
// review, N1): Kuma owns it then, and the outage is its red card. With the
// monitor up it holds nothing, so it is unmonitored and leaves a breadcrumb.
test('assemble: a vanished container whose matching monitor is DOWN is NOT a breadcrumb (Kuma owns it)', () => {
  const { nodes, breadcrumbCount } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'postgres', status: 'down', active: true } },
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
    ]),
  });
  assert.equal(nodes.vm103.services.some((s) => s.container === 'postgres' && s.source === 'presence'), false);
  assert.equal(nodes.vm103.services.find((s) => s.uid === 'vm103:postgres').source, 'monitor');
  assert.equal(breadcrumbCount, 0);
});

test('assemble: a vanished container whose matching monitor is UP is a breadcrumb (it holds no monitor)', () => {
  const { nodes, breadcrumbCount } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'postgres', status: 'up', active: true } },
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
    ]),
  });
  assert.equal(nodes.vm103.services.find((s) => s.container === 'postgres').source, 'presence');
  assert.equal(breadcrumbCount, 1);
});

test('assemble: a vanished container mapped to a down monitor via EXPLICIT override is NOT a breadcrumb (Kuma owns it)', () => {
  // 'pgmon' does NOT fuzzy-match 'postgres'; only the explicit
  // config.services.postgres.monitor mapping links them. The breadcrumb guard
  // must honor that override (mirror the running-card path) — else a tracked
  // service leaks out as a grey breadcrumb beside its red card.
  const assemble = (status) =>
    assembleServices({
      nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
      monitors: { 1: { id: 1, name: 'pgmon', status, active: true } },
      config: { services: { postgres: { monitor: 'pgmon' } } },
      lastSeenNodeOf: () => null,
      containerRegistry: fakeRegistry([
        { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
      ]),
      now: () => 0,
    });
  const down = assemble('down');
  assert.deepEqual(
    down.nodes.vm103.services.filter((s) => s.container === 'postgres').map((s) => `${s.uid} ${s.source} ${s.status}`),
    ['vm103:postgres monitor down']
  );
  assert.equal(down.breadcrumbCount, 0);
  // Monitor up: the container is gone and holds nothing, so it is a breadcrumb.
  const up = assemble('up');
  assert.equal(up.breadcrumbCount, 1);
  assert.equal(up.nodes.vm103.services.find((s) => s.container === 'postgres').source, 'presence');
});

test('assemble: a candidate that is actually RUNNING this cycle is NOT a breadcrumb (defensive skip)', () => {
  const { nodes, breadcrumbCount } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'postgres', status: 'running', docker: { cpu: 3 } }])]],
    monitors: {},
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
    ]),
  });
  const pgs = nodes.vm103.services.filter((s) => s.container === 'postgres');
  assert.equal(pgs.length, 1);
  assert.equal(pgs[0].source, 'container');     // the live running card, not a breadcrumb
  assert.equal(breadcrumbCount, 0);
});

test('assemble: the establish-guard is honored end-to-end through a real registry', () => {
  const path = join(tmpdir(), `jaghelm-assemble-${process.pid}-establish.json`);
  try {
    const reg = createContainerRegistry({ path });
    reg.recordSeen('build-job', 'vm103', 0);        // single sight, span 0 < establish
    const { nodes, breadcrumbCount } = assembleServices({
      nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
      monitors: {},
      config: { services: {} },
      lastSeenNodeOf: () => null,
      containerRegistry: reg,
      now: () => 200_000,
    });
    assert.equal(nodes.vm103.services.some((s) => s.container === 'build-job'), false);
    assert.equal(breadcrumbCount, 0);
  } finally { if (existsSync(path)) rmSync(path); }
});

test('assemble: final order per node is down → unknown → up', () => {
  const { nodes } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([
      { container: 'alpha', status: 'running', docker: {} },   // up
      { container: 'gitea', status: 'running', docker: {} },   // down via monitor
    ])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'down', active: true } },
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 }, // unknown breadcrumb
    ]),
  });
  assert.deepEqual(
    nodes.vm103.services.map((s) => s.status),
    ['down', 'unknown', 'up']
  );
});

// ---- server-computed global health (user-approved refinement 2026-06-27) ----

test('assemble: overallHealth is "down" when any card is down', () => {
  const { overallHealth } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'down', active: true } },
  });
  assert.equal(overallHealth, 'down');
});

test('assemble: overallHealth is "degraded" when a presence breadcrumb is unknown but nothing is down', () => {
  const { overallHealth } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'up', active: true } },
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
    ]),
  });
  assert.equal(overallHealth, 'degraded');
});

test('assemble: overallHealth is "up" when every card is up/running', () => {
  const { overallHealth } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([
      { container: 'gitea', status: 'running', docker: {} },
      { container: 'grafana', status: 'running', docker: {} },
    ])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'up', active: true } },
  });
  assert.equal(overallHealth, 'up');
});

test('assemble: overallHealth is "unknown" when there are no cards', () => {
  const { overallHealth } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([])]],
    monitors: {},
  });
  assert.equal(overallHealth, 'unknown');
});

test('assemble: unmatched[] lists running, shown containers no monitor matched (for the once-per-boot summary)', () => {
  const { unmatched, containerCount } = run({
    nodeResults: [
      ['vm103', { ...nodeCfg, hide: ['cadvisor'] }, nodeData([
        { container: 'gitea', status: 'running', docker: {} },
        { container: 'watchtower', status: 'running', docker: {} },
        { container: 'cadvisor', status: 'running', docker: {} }, // hidden: not on the board
        { container: 'alloy', status: 'running', docker: {} },
      ])],
      ['pi-1', nodeCfg, nodeData([{ container: 'alloy', status: 'running', docker: {} }])],
    ],
    monitors: { 1: { id: 1, name: 'gitea', status: 'up', active: true } },
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 }, // breadcrumb, not running
    ]),
  });
  assert.deepEqual(unmatched, ['alloy', 'watchtower']); // unique, sorted
  assert.equal(containerCount, 4);
});

// ---- one record per name per cycle (#241) ----
// The same container name runs on several hosts (cadvisor, alloy,
// node-exporter on every node). Recording it once per node flipped its
// lastSeenNode within every pass, so the registries wrote every cycle.

function countingWrite() {
  const spy = { writes: 0, write: () => { spy.writes += 1; } };
  return spy;
}

const twoNodes = [
  ['vm103', nodeCfg, nodeData([{ container: 'cadvisor', status: 'running', docker: {} }, { container: 'haproxy', status: 'running', docker: {} }])],
  ['pi1', nodeCfg, nodeData([{ container: 'cadvisor', status: 'running', docker: {} }, { container: 'haproxy', status: 'running', docker: {} }])],
];

test('assemble: a container name on two nodes is recorded once a cycle, so steady cycles write nothing', () => {
  const path = join(tmpdir(), `jaghelm-assemble-${process.pid}-dupname.json`);
  const spy = countingWrite();
  let t = 0;
  try {
    const reg = createContainerRegistry({ path, now: () => t, write: spy.write });
    const perCycle = [];
    for (let i = 0; i < 9; i += 1) {
      t = i * 30_000;
      const before = spy.writes;
      run({ nodeResults: twoNodes, monitors: {}, containerRegistry: reg, now: () => t });
      reg.prune();
      reg.save();
      perCycle.push(spy.writes - before);
    }
    // New containers at 0 s, established at 60 s, then nothing.
    assert.deepEqual(perCycle, [1, 0, 1, 0, 0, 0, 0, 0, 0]);
    assert.equal(reg.snapshot().cadvisor.lastSeenNode, 'pi1', 'the last node in the pass, as before');
  } finally { if (existsSync(path)) rmSync(path); }
});

test('assemble: a monitor whose container runs on two nodes goes to one of them, so the service registry writes nothing in steady cycles', () => {
  const path = join(tmpdir(), `jaghelm-assemble-${process.pid}-dupmonitor.json`);
  const spy = countingWrite();
  try {
    const reg = createServiceRegistry({ path, now: () => 0, write: spy.write });
    const perCycle = [];
    for (let i = 0; i < 5; i += 1) {
      const before = spy.writes;
      const { seen } = run({ nodeResults: twoNodes, monitors: { 7: { id: 7, name: 'haproxy', status: 'up', active: true } } });
      // One container per monitor (#240): the first node in board order.
      assert.deepEqual(seen, [{ monitorId: 7, nodeKey: 'vm103', container: 'haproxy' }]);
      for (const { monitorId, nodeKey, container } of seen) reg.recordSeen(monitorId, nodeKey, container);
      reg.save();
      perCycle.push(spy.writes - before);
    }
    assert.deepEqual(perCycle, [1, 0, 0, 0, 0]);
  } finally { if (existsSync(path)) rmSync(path); }
});

// ---- #232: a failed Prometheus poll draws no breadcrumbs ----

test('assemble: with presence unknown (a Prometheus query failed) no breadcrumb is drawn', () => {
  const missing = [{ container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 }];
  const args = {
    nodeResults: [['vm103', nodeCfg, nodeData([])]],
    monitors: { 7: { id: 7, name: 'Radarr', status: 'down', active: true } },
    lastSeen: { 7: 'vm103' },
    lastSeenContainer: { 7: 'radarr' },
    containerRegistry: fakeRegistry(missing),
  };
  const unknown = run({ ...args, presenceKnown: false });
  assert.equal(unknown.breadcrumbCount, 0);
  assert.deepEqual(
    unknown.nodes.vm103.services.map((s) => `${s.uid} ${s.status}`),
    ['vm103:radarr down'],
    'Kuma outage cards still drawn'
  );
  assert.equal(run(args).breadcrumbCount, 1, 'presence known (the default): drawn as before');
});

test('assemble: #476: a node unread for a reason that lasts holds back its own breadcrumbs only; its verdict is kept for the status model', () => {
  const missing = [
    { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
    { container: 'adguard', lastSeenNode: 'pi', lastSeenAt: 1000, ageMs: 120_000 },
  ];
  const unread = ['containers', 'cpu', 'disk', 'mem', 'reachable', 'temp', 'uptime'];
  const r = run({
    nodeResults: [
      ['vm103', nodeCfg, { ...nodeData([]), failedReads: unread, whyNoUp: 'not-scraped-too-long' }],
      ['pi', nodeCfg, { ...nodeData([]), reachable: true }],
    ],
    monitors: {},
    containerRegistry: fakeRegistry(missing),
  });
  assert.deepEqual(r.nodes.vm103.services, [], 'what vm103 ran may still run there');
  assert.deepEqual(r.nodes.pi.services.map((s) => `${s.uid} ${s.source}`), ['pi:adguard presence']);
  assert.equal(r.breadcrumbCount, 1);
  assert.deepEqual(r.whyNoUp, { vm103: 'not-scraped-too-long' });
});

test('assemble: each node carries reachable from discovery, null when it has none', () => {
  const { nodes } = run({
    nodeResults: [
      ['a', nodeCfg, { ...nodeData([]), reachable: true }],
      ['b', nodeCfg, { ...nodeData([]), reachable: false }],
      ['c', nodeCfg, nodeData([])],
    ],
    monitors: {},
  });
  assert.deepEqual([nodes.a.reachable, nodes.b.reachable, nodes.c.reachable], [true, false, null]);
});

test('assemble: each node carries the failedReads discovery reported, [] when it has none', () => {
  const { nodes } = run({
    nodeResults: [
      ['a', nodeCfg, { ...nodeData([]), failedReads: ['cpu', 'temp'] }],
      ['b', nodeCfg, nodeData([])],
    ],
    monitors: {},
  });
  assert.deepEqual(nodes.a.failedReads, ['cpu', 'temp']);
  assert.deepEqual(nodes.b.failedReads, []);
});

// ---- one container per monitor (#240) ----

// The audit's mock (#240), rebuilt from its description: one down monitor, eight
// containers on five nodes sharing its word "gateway", and five other monitors
// sharing it too. Each container used to take the first monitor with a shared
// word, the down one, so it painted all eight red (eight push uids) and the
// other five were never matched.
const AUDIT_NODES = {
  pi1: ['gateway-npm', 'gateway-tunnel'],
  pi2: ['gateway-npm', 'gateway-tunnel'],
  vm101: ['gateway-npm'],
  vm103: ['gateway-tunnel'],
  nas: ['gateway-backup', 'gateway-sync'],
};
function auditMonitors(pingStatus) {
  const m = (id, name, status = 'up') => ({ id, name, status, ping: 3, uptime24: 1, active: true, lastBeatAt: null });
  return {
    1: m(1, 'Pi Gateway (Ping)', pingStatus),
    2: m(2, 'NPM Gateway Primary'),
    3: m(3, 'NPM Gateway Secondary'),
    4: m(4, 'Tunnel Gateway Primary'),
    5: m(5, 'Tunnel Gateway Secondary'),
    6: m(6, 'Backup Gateway Job'),
  };
}
// `rotate` turns each node's container list, as discovery may list them in
// another order on another cycle.
function auditNodeResults(rotate = 0) {
  return Object.entries(AUDIT_NODES).map(([nodeKey, names]) => {
    const k = rotate % names.length;
    const order = [...names.slice(k), ...names.slice(0, k)];
    return [nodeKey, nodeCfg, nodeData(order.map((container) => ({ container, status: 'running', docker: {} })))];
  });
}
const cards = (nodes) => Object.values(nodes).flatMap((n) => n.services);

test('assemble (#240 audit mock): one down monitor marks exactly one container, and sends one push', () => {
  // The registry as the old matcher left it: monitor 1 last seen on the last
  // of its eight containers.
  const old = { lastSeen: { 1: 'nas' }, lastSeenContainer: { 1: 'gateway-sync' } };
  const up = run({ nodeResults: auditNodeResults(), monitors: auditMonitors('up'), ...old });
  const down = run({ nodeResults: auditNodeResults(), monitors: auditMonitors('down'), ...old });

  const red = cards(down.nodes).filter((s) => s.status === 'down');
  assert.deepEqual(red.map((s) => s.uid), ['vm101:gateway-npm'], 'one red card (was 8)');
  assert.equal(cards(down.nodes).length, 8, 'no synthesised card besides the eight containers');

  // Every monitor marks one container; the five that were never matched now are.
  assert.equal(down.seen.length, 6);
  assert.equal(new Set(down.seen.map((s) => `${s.nodeKey}:${s.container}`)).size, 6);
  assert.equal(cards(down.nodes).filter((s) => s.monitored).length, 6);

  const events = diffSnapshots(pushSnap(up), pushSnap(down, pushSnap(up)));
  assert.deepEqual(
    events.filter((e) => e.type === 'service_down').map((e) => e.id),
    ['vm101:gateway-npm'],
    'one push (was 8)'
  );
});

test('assemble (#240 audit mock): the service registry is written when the matching changes, then not again', () => {
  const path = join(tmpdir(), `jaghelm-assemble-${process.pid}-audit-registry.json`);
  const spy = countingWrite();
  try {
    // What the old matcher left: monitor 1 on the last of its eight containers.
    writeFileSync(path, JSON.stringify({ 1: { lastSeenNode: 'nas', lastSeenAt: 0, lastSeenContainer: 'gateway-sync' } }));
    const reg = createServiceRegistry({ path, now: () => 0, write: spy.write });
    const perCycle = [];
    for (let i = 0; i < 6; i += 1) {
      const before = spy.writes;
      const { seen } = assembleServices({
        nodeResults: auditNodeResults(i), // discovery's order changes every cycle
        monitors: auditMonitors(i % 2 ? 'down' : 'up'),
        config: { services: {} },
        lastSeenNodeOf: (id) => reg.getLastSeenNode(id),
        lastSeenContainerOf: (id) => reg.getLastSeenContainer(id),
        containerRegistry: null,
        now: () => 0,
      });
      for (const { monitorId, nodeKey, container } of seen) reg.recordSeen(monitorId, nodeKey, container);
      reg.save();
      perCycle.push(spy.writes - before);
    }
    assert.deepEqual(perCycle, [1, 0, 0, 0, 0, 0]);
    assert.deepEqual(reg.snapshot()['1'], { lastSeenNode: 'vm101', lastSeenAt: 0, lastSeenContainer: 'gateway-npm' });
  } finally { if (existsSync(path)) rmSync(path); }
});

test('assemble: the live shape — mappings to monitors Kuma lacks no longer paint lookalikes red', () => {
  // Live on 2026-10-19: gateway-npm and gateway-tunnel run on both Pis and are
  // mapped to "Nginx Proxy Manager" and "Cloudflared", which Kuma does not
  // have. They used to fall back to a name match and all four took
  // "Pi Gateway (Ping)" by its word "gateway".
  const config = {
    services: {
      'gateway-npm': { monitor: 'Nginx Proxy Manager' },
      'gateway-tunnel': { monitor: 'Cloudflared' },
      tailscale: { monitor: 'Tailscale' },
    },
  };
  const pi = (names) => nodeData(names.map((container) => ({ container, status: 'running', docker: {} })));
  const { nodes, unmatched } = assembleServices({
    nodeResults: [
      ['pi1', nodeCfg, pi(['adguard', 'gateway-npm', 'gateway-tunnel'])],
      ['pi2', nodeCfg, pi(['gateway-npm', 'gateway-tunnel', 'tailscale'])],
    ],
    monitors: {
      1: { id: 1, name: 'Pi Gateway (Ping)', status: 'down', active: true },
      2: { id: 2, name: 'Adguard Primary', status: 'up', active: true },
    },
    config,
    lastSeenNodeOf: (id) => (id === 1 ? 'pi2' : null),
    lastSeenContainerOf: (id) => (id === 1 ? 'gateway-tunnel' : null),
    containerRegistry: null,
    now: () => 0,
  });
  const all = cards(nodes);
  assert.deepEqual(
    all.filter((s) => s.status === 'down').map((s) => `${s.uid} ${s.source}`),
    ['pi2:Pi Gateway (Ping) monitor'],
    'the down monitor is its own card, not four red gateway cards'
  );
  assert.equal(new Set(all.map((s) => s.uid)).size, all.length, 'no two cards share a uid');
  assert.deepEqual(unmatched, ['gateway-npm', 'gateway-tunnel', 'tailscale']);
  assert.equal(all.find((s) => s.uid === 'pi1:adguard').monitored, true);
});

test('assemble: a down monitor stays with its stopped container, not a running lookalike', () => {
  const { nodes, breadcrumbCount } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea-runner', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'Gitea', status: 'down', active: true } },
    lastSeen: { 1: 'vm103' },
    lastSeenContainer: { 1: 'gitea' },
    containerRegistry: fakeRegistry([{ container: 'gitea', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 }]),
  });
  const byUid = Object.fromEntries(nodes.vm103.services.map((s) => [s.uid, s]));
  assert.equal(byUid['vm103:gitea-runner'].status, 'up', 'the runner keeps its own status');
  assert.equal(byUid['vm103:gitea-runner'].monitored, false);
  assert.equal(byUid['vm103:gitea'].status, 'down', 'the outage is on the stopped container');
  assert.equal(byUid['vm103:gitea'].source, 'monitor');
  assert.equal(breadcrumbCount, 0, 'Kuma owns the stopped container');
});

test('assemble: a stopped container whose lookalike got the monitor is unmonitored, so it leaves a breadcrumb', () => {
  const { nodes, breadcrumbCount } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'nextcloud-app', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'Nextcloud', status: 'up', active: true } },
    containerRegistry: fakeRegistry([{ container: 'nextcloud-cron', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 }]),
  });
  assert.equal(breadcrumbCount, 1);
  const cron = nodes.vm103.services.find((s) => s.container === 'nextcloud-cron');
  assert.equal(cron.source, 'presence');
  assert.equal(nodes.vm103.services.find((s) => s.container === 'nextcloud-app').monitored, true);
});

test('assemble: two down monitors last matched to one container get a card each, under distinct uids', () => {
  // The old matcher could leave two monitors remembering the same container.
  const { nodes } = run({
    nodeResults: [['pi2', nodeCfg, nodeData([])]],
    monitors: {
      1: { id: 1, name: 'Adguard Primary', status: 'down', active: true },
      2: { id: 2, name: 'Adguard Secondary', status: 'down', active: true },
    },
    lastSeen: { 1: 'pi2', 2: 'pi2' },
    lastSeenContainer: { 1: 'adguard-sync', 2: 'adguard-sync' },
  });
  assert.deepEqual(nodes.pi2.services.map((s) => s.uid).sort(), ['pi2:Adguard Secondary', 'pi2:adguard-sync']);
});

test('assemble: an explicit mapping marks every container mapped to the monitor', () => {
  const { nodes, seen } = assembleServices({
    nodeResults: [
      ['pi1', nodeCfg, nodeData([{ container: 'haproxy', status: 'running', docker: {} }])],
      ['pi2', nodeCfg, nodeData([{ container: 'haproxy', status: 'running', docker: {} }])],
    ],
    monitors: { 1: { id: 1, name: 'HAProxy VIP', status: 'down', active: true } },
    config: { services: { haproxy: { monitor: 'HAProxy VIP' } } },
    lastSeenNodeOf: () => null,
    containerRegistry: null,
    now: () => 0,
  });
  assert.deepEqual(cards(nodes).map((s) => `${s.uid} ${s.status}`), ['pi1:haproxy down', 'pi2:haproxy down']);
  assert.deepEqual(seen, [{ monitorId: 1, nodeKey: 'pi2', container: 'haproxy' }], 'recorded once, on the last node');
});

// The live board (2026-10-19): vaultwarden runs on vm103 and on pi2, and the
// config lists vm101, vm103, pi2, pi1. The matcher keeps no memory of where it
// put a monitor (#240 review, S3): ties go by board order, every cycle.
const VW_NODES = ['vm101', 'vm103', 'pi2', 'pi1'];
const vaultwarden = (status) => ({ 9: { id: 9, name: 'Vaultwarden', status, active: true } });
function vwCycle(reg, onNodes, { status = 'up', config = { services: {} } } = {}) {
  const nodeResults = VW_NODES.map((nodeKey) => [
    nodeKey,
    nodeCfg,
    nodeData(onNodes.includes(nodeKey) ? [{ container: 'vaultwarden', status: 'running', docker: {} }] : []),
  ]);
  const out = assembleServices({
    nodeResults,
    monitors: vaultwarden(status),
    config,
    lastSeenNodeOf: (id) => reg.getLastSeenNode(id),
    lastSeenContainerOf: (id) => reg.getLastSeenContainer(id),
    containerRegistry: null,
    now: () => 0,
  });
  for (const { monitorId, nodeKey, container } of out.seen) reg.recordSeen(monitorId, nodeKey, container);
  return out;
}
const monitoredUids = (nodes) => cards(nodes).filter((s) => s.monitored).map((s) => `${s.uid} ${s.status}`);

test('assemble: one missed cycle of vm103 vaultwarden does not move the monitor to pi2 for good', () => {
  const path = join(tmpdir(), `jaghelm-assemble-${process.pid}-vw-gap.json`);
  try {
    // The registry as the old matcher left it: pi2, the last node of its pass.
    writeFileSync(path, JSON.stringify({ 9: { lastSeenNode: 'pi2', lastSeenAt: 0, lastSeenContainer: 'vaultwarden' } }));
    const reg = createServiceRegistry({ path, now: () => 0 });
    assert.deepEqual(monitoredUids(vwCycle(reg, ['vm103', 'pi2']).nodes), ['vm103:vaultwarden up'], 'board order, not the old record');
    // vm103's container misses one cycle (a recreate): the replica has it meanwhile.
    assert.deepEqual(monitoredUids(vwCycle(reg, ['pi2']).nodes), ['pi2:vaultwarden up']);
    // and gives it back the cycle vm103's is back, and every cycle after.
    for (let i = 0; i < 3; i += 1) {
      assert.deepEqual(monitoredUids(vwCycle(reg, ['vm103', 'pi2']).nodes), ['vm103:vaultwarden up']);
    }
    assert.equal(reg.getLastSeenNode(9), 'vm103');
  } finally { if (existsSync(path)) rmSync(path); }
});

test('assemble: vaultwarden pinned with monitor_per_node never goes to the pi2 replica, and its outage lands on vm103', () => {
  const path = join(tmpdir(), `jaghelm-assemble-${process.pid}-vw-pinned.json`);
  try {
    const reg = createServiceRegistry({ path, now: () => 0 });
    const config = { nodes: Object.fromEntries(VW_NODES.map((n) => [n, {}])), services: { vaultwarden: { monitor_per_node: { vm103: 'Vaultwarden' } } } };
    assert.deepEqual(monitoredUids(vwCycle(reg, ['vm103', 'pi2'], { config }).nodes), ['vm103:vaultwarden up']);
    // vm103's container is gone and the monitor stays up: nobody has it.
    assert.deepEqual(monitoredUids(vwCycle(reg, ['pi2'], { config }).nodes), []);
    // vm103's container is gone and the monitor is down: a red card on vm103,
    // on the uid its running card had, and pi2's replica keeps its own status.
    const down = vwCycle(reg, ['pi2'], { config, status: 'down' });
    assert.deepEqual(monitoredUids(down.nodes), ['vm103:vaultwarden down']);
    assert.equal(down.nodes.pi2.services[0].status, 'up');
    const back = vwCycle(reg, ['vm103', 'pi2'], { config });
    assert.deepEqual(monitoredUids(back.nodes), ['vm103:vaultwarden up'], 'recovers on the same uid');
  } finally { if (existsSync(path)) rmSync(path); }
});

// #342 with monitor_per_node: each Pi's gateway-npm has its own NPM monitor,
// and gateway-tunnel opts out instead of taking "Pi Gateway (Ping)".
test('assemble: the two Pis\' gateway-npm mapped to "NPM Pi Primary" and "NPM Pi Secondary"', () => {
  const config = {
    nodes: { pi1: {}, pi2: {} },
    services: {
      'gateway-npm': { monitor_per_node: { pi1: 'NPM Pi Primary', pi2: 'NPM Pi Secondary' } },
      'gateway-tunnel': { monitor: false },
    },
  };
  const pi = (names) => nodeData(names.map((container) => ({ container, status: 'running', docker: {} })));
  const { nodes, seen } = assembleServices({
    nodeResults: [
      ['pi1', nodeCfg, pi(['gateway-npm', 'gateway-tunnel'])],
      ['pi2', nodeCfg, pi(['gateway-npm', 'gateway-tunnel'])],
    ],
    monitors: {
      1: { id: 1, name: 'NPM Pi Primary', status: 'up', active: true },
      2: { id: 2, name: 'NPM Pi Secondary', status: 'down', active: true },
      3: { id: 3, name: 'Pi Gateway (Ping)', status: 'up', active: true },
    },
    config,
    lastSeenNodeOf: () => null,
    containerRegistry: null,
    now: () => 0,
  });
  assert.deepEqual(monitoredUids(nodes), ['pi1:gateway-npm up', 'pi2:gateway-npm down']);
  assert.deepEqual(seen.map((s) => `${s.monitorId} ${s.nodeKey}:${s.container}`).sort(), ['1 pi1:gateway-npm', '2 pi2:gateway-npm']);
  assert.equal(cards(nodes).filter((s) => s.container === 'gateway-tunnel' && s.monitored).length, 0);
});

test('assemble: a container opted out with monitor: false is not listed as unmatched', () => {
  const { unmatched } = assembleServices({
    nodeResults: [['pi1', nodeCfg, nodeData(['gateway-tunnel', 'alloy'].map((container) => ({ container, status: 'running', docker: {} })))]],
    monitors: { 1: { id: 1, name: 'Pi Gateway (Ping)', status: 'up', active: true } },
    config: { services: { 'gateway-tunnel': { monitor: false } } },
    lastSeenNodeOf: () => null,
    containerRegistry: null,
    now: () => 0,
  });
  assert.deepEqual(unmatched, ['alloy']);
});

// ---- CI job containers (#240 review, B1) ----

const JOB = 'GITEA-ACTIONS-TASK-5440-WORKFLOW-check-JOB-check-13296247f24e890e404c408850ed614fbd19f6f6c90bab756e7058625e81200b';

test('assemble: a finished CI job leaves no breadcrumb and keeps the global status up', () => {
  // Recorded by a version that did not drop job containers yet; gitea runs
  // and has "Gitea", so the job used to be the stopped lookalike.
  const { nodes, breadcrumbCount, overallHealth } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'Gitea', status: 'down', active: true } },
    containerRegistry: fakeRegistry([{ container: JOB, lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 }]),
  });
  assert.equal(breadcrumbCount, 0);
  assert.deepEqual(cards(nodes).map((s) => `${s.uid} ${s.status}`), ['vm103:gitea down'], 'the job takes no monitor either');
  assert.equal(overallHealth, 'down', 'from gitea, not the job');
  const up = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'Gitea', status: 'up', active: true } },
    containerRegistry: fakeRegistry([{ container: JOB, lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 }]),
  });
  assert.equal(up.breadcrumbCount, 0);
  assert.equal(up.overallHealth, 'up', 'was degraded for 24 h after each job');
});

// ---- stopped containers hold only a down monitor (#240 review, N1) ----

test('assemble: a stopped container releases an up monitor to the running one, and leaves a breadcrumb', () => {
  // nextcloud renamed to nextcloud-app: the old name is still in the registry.
  const { nodes, breadcrumbCount } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'nextcloud-app', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'Nextcloud', status: 'up', active: true } },
    containerRegistry: fakeRegistry([{ container: 'nextcloud', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 }]),
  });
  const byUid = Object.fromEntries(nodes.vm103.services.map((s) => [s.uid, s]));
  assert.equal(byUid['vm103:nextcloud-app'].monitored, true, 'the monitor shows on the running container');
  assert.equal(byUid['vm103:nextcloud'].source, 'presence');
  assert.equal(breadcrumbCount, 1);
});

// ---- a monitor no container has sends its recovery push (#390) ----
//
// The live shape on 2026-10-19: NAS (Ping), NAS UI, Network Switch and Proxmox
// UI never had a container, and Pi Gateway (Ping) last rode on pi2's
// gateway-tunnel, which is now opted out and still runs there. Their card
// existed only while they were down, so each sent service_down and never
// service_recovered.


const LIVE_MONITORS = ['Gitea', 'NAS (Ping)', 'NAS UI', 'Network Switch', 'Proxmox UI', 'Pi Gateway (Ping)'];
// One cycle of the live shape. `monitors` maps a monitor name to its status, or
// to a whole monitor (a paused one), or to null for one Kuma no longer has.
function liveCycle(monitors = {}) {
  const all = {};
  LIVE_MONITORS.forEach((name, i) => {
    const given = Object.hasOwn(monitors, name) ? monitors[name] : 'up';
    if (given === null) return;
    const base = { id: i + 1, name, ping: 1, uptime24: 1, active: true, lastBeatAt: null };
    all[i + 1] = typeof given === 'string' ? { ...base, status: given } : { ...base, ...given };
  });
  return assembleServices({
    nodeResults: [
      ['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])],
      ['pi2', nodeCfg, nodeData([{ container: 'gateway-tunnel', status: 'running', docker: {} }])],
    ],
    monitors: all,
    config: { services: { 'gateway-tunnel': { monitor: false } } },
    lastSeenNodeOf: (id) => (all[id]?.name === 'Pi Gateway (Ping)' ? 'pi2' : null),
    lastSeenContainerOf: (id) => (all[id]?.name === 'Pi Gateway (Ping)' ? 'gateway-tunnel' : null),
    containerRegistry: null,
    now: () => 10_000_000,
  });
}

test('push (#390): a monitor no container has sends service_down, then service_recovered on the same id', () => {
  const up = liveCycle();
  const down = liveCycle({ 'NAS (Ping)': 'down', 'Pi Gateway (Ping)': 'down' });
  const back = liveCycle();
  assert.deepEqual(pushes(up, down), ['service_down pi2:Pi Gateway (Ping)', 'service_down vm103:NAS (Ping)']);
  assert.deepEqual(pushes(down, back), ['service_recovered pi2:Pi Gateway (Ping)', 'service_recovered vm103:NAS (Ping)']);
  assert.deepEqual(pushes(back, liveCycle()), [], 'and nothing while it stays up');
});

test('assemble (#390): an up monitor no container has draws no card; only the push snapshot reads it', () => {
  const r = liveCycle();
  assert.deepEqual(cards(r.nodes).map((s) => s.uid).sort(), ['pi2:gateway-tunnel', 'vm103:gitea'], 'no new green cards');
  assert.equal(r.overallHealth, 'up');
  assert.deepEqual(r.upWithoutCard, [
    'vm103:NAS (Ping)',
    'vm103:NAS UI',
    'vm103:Network Switch',
    'vm103:Proxmox UI',
    'pi2:Pi Gateway (Ping)',
  ]);
  // gateway-tunnel has no monitor (`monitor: false`): a container, which push
  // has nothing to say about (#292).
  assert.deepEqual(servicesOf(r), {
    'pi2:Pi Gateway (Ping)': 'up',
    'vm103:gitea': 'up',
    'vm103:NAS (Ping)': 'up',
    'vm103:NAS UI': 'up',
    'vm103:Network Switch': 'up',
    'vm103:Proxmox UI': 'up',
  });
  // Down, the same monitor is a red card under the same uid, and is not listed.
  const down = liveCycle({ 'NAS UI': 'down' });
  assert.equal(cards(down.nodes).find((s) => s.uid === 'vm103:NAS UI').status, 'down');
  assert.equal(down.upWithoutCard.includes('vm103:NAS UI'), false);
});

test('push (#390): a paused monitor, or one Kuma no longer has, sends nothing; an active one recovers', () => {
  const now = 10_000_000;
  const stale = now - 11 * 60_000; // past JAGHELM_MONITOR_STALE_MS (10 min): Kuma stopped checking it
  const down = liveCycle({ 'NAS (Ping)': 'down', 'NAS UI': 'down', 'Network Switch': 'down', 'Proxmox UI': 'down' });
  const later = liveCycle({
    'NAS (Ping)': { status: 'down', lastBeatAt: stale }, // paused while down
    'NAS UI': { status: 'up', active: false }, // paused, as a status page that flags it reports it
    'Network Switch': 'up', // back up
    'Proxmox UI': null, // deleted from Kuma
  });
  assert.deepEqual(pushes(down, later), ['service_recovered vm103:Network Switch']);
  assert.deepEqual(Object.keys(servicesOf(later)).filter((uid) => /NAS|Proxmox/.test(uid)), [], 'all three absent');
  // A monitor paused while up is absent too, so it sends nothing when it is unpaused.
  const pausedUp = liveCycle({ 'NAS (Ping)': { status: 'up', lastBeatAt: stale } });
  assert.equal(pausedUp.upWithoutCard.includes('vm103:NAS (Ping)'), false);
  assert.deepEqual(pushes(pausedUp, liveCycle()), []);
});

test('assemble (#390): a monitor keeps its uid from down to up where two monitors compete for one', () => {
  // The old matcher could leave two monitors remembering the same container.
  // Both are placed in one pass, whatever their status, so each keeps its uid.
  const cycle = (primary, secondary) =>
    run({
      nodeResults: [['pi2', nodeCfg, nodeData([])]],
      monitors: {
        1: { id: 1, name: 'Adguard Primary', status: primary, active: true },
        2: { id: 2, name: 'Adguard Secondary', status: secondary, active: true },
      },
      lastSeen: { 1: 'pi2', 2: 'pi2' },
      lastSeenContainer: { 1: 'adguard-sync', 2: 'adguard-sync' },
    });
  for (const [primary, secondary] of [['down', 'down'], ['down', 'up'], ['up', 'down'], ['up', 'up']]) {
    assert.deepEqual(
      servicesOf(cycle(primary, secondary)),
      { 'pi2:Adguard Secondary': secondary, 'pi2:adguard-sync': primary },
      `${primary}/${secondary}`
    );
  }
  assert.deepEqual(pushes(cycle('up', 'down'), cycle('up', 'up')), ['service_recovered pi2:Adguard Secondary']);
});

test('push (#390): an up entry wins over a grey breadcrumb with its uid, so the recovery is sent', () => {
  // NAS UI rides on vm103's nas-ui, which stopped an hour ago (inside the
  // presence TTL). Down, the stopped container keeps the monitor: a red card
  // under its name. Up, it holds nothing and leaves a grey breadcrumb on the uid
  // the monitor's own up entry has. The entry wins there, so the recovery diffs
  // on the key of the down push.
  const cycle = (status) =>
    run({
      nodeResults: [['vm103', nodeCfg, nodeData([])]],
      monitors: { 1: { id: 1, name: 'NAS UI', status, active: true } },
      lastSeen: { 1: 'vm103' },
      lastSeenContainer: { 1: 'nas-ui' },
      containerRegistry: fakeRegistry([{ container: 'nas-ui', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 3_600_000 }]),
    });
  const down = cycle('down');
  assert.deepEqual(cards(down.nodes).map((s) => `${s.uid} ${s.status}`), ['vm103:nas-ui down']);
  const up = cycle('up');
  assert.deepEqual(up.upWithoutCard, ['vm103:nas-ui']);
  assert.deepEqual(cards(up.nodes).map((s) => `${s.uid} ${s.source}`), ['vm103:nas-ui presence'], 'the board keeps the breadcrumb');
  assert.deepEqual(servicesOf(up), { 'vm103:nas-ui': 'up' }, 'the entry, not the breadcrumb');
  assert.deepEqual(pushes(down, up), ['service_recovered vm103:nas-ui']);
  // At deploy, the last snapshot read the breadcrumb: unknown -> up sends nothing.
  const deployed = { ...pushSnap(up), services: { 'vm103:nas-ui': 'unknown' } };
  assert.deepEqual(diffSnapshots(deployed, pushSnap(up, deployed)), []);
});

// The transition: a monitor feeds ONE key a cycle. A running container that has
// it: that container's card. None: its own uid (placement), a red card while
// down, the up entry while up. When a container takes it, its own key leaves the
// snapshot without an event and the container's card starts with no previous
// status; when the container goes, its own uid is that container's (the service
// registry remembers it), so the key does not move. Never two keys at once, so
// one change of status is one push.
test('push (#390): a container taking or leaving the monitor moves it to one key, and the move sends nothing', () => {
  const seen = new Map(); // the service registry: monitor id -> { nodeKey, container }
  const cycle = (status, containers) => {
    const r = run({
      nodeResults: [['vm103', nodeCfg, nodeData(containers.map((container) => ({ container, status: 'running', docker: {} })))]],
      monitors: { 1: { id: 1, name: 'Grafana', status, active: true } },
      lastSeen: Object.fromEntries([...seen].map(([id, s]) => [id, s.nodeKey])),
      lastSeenContainer: Object.fromEntries([...seen].map(([id, s]) => [id, s.container])),
    });
    for (const s of r.seen) seen.set(String(s.monitorId), s);
    return r;
  };
  const keysOfMonitor = (r) => Object.keys(servicesOf(r)).filter((uid) => /grafana/i.test(uid));

  const steps = [
    ['up', []], // no container: its own uid, from its name
    ['down', []],
    ['up', []],
    ['up', ['grafana']], // a container appears and takes it, while it is up
    ['down', ['grafana']],
    ['up', ['grafana']],
    ['up', []], // the container goes for good: its own uid is the container's now
    ['down', []],
    ['up', []],
  ];
  const sent = [];
  let prev = null;
  for (const [status, containers] of steps) {
    const r = cycle(status, containers);
    assert.equal(keysOfMonitor(r).length, 1, `one key at ${status} ${containers}`);
    if (prev) sent.push(...pushes(prev, r));
    prev = r;
  }
  assert.deepEqual(sent, [
    'service_down vm103:Grafana',
    'service_recovered vm103:Grafana',
    'service_down vm103:grafana',
    'service_recovered vm103:grafana',
    'service_down vm103:grafana',
    'service_recovered vm103:grafana',
  ]);
});

// ── the monitor each uid carries, for the push snapshot (#395) ──

test('assemble (#395): monitorOf names the monitor of each running card, red card and up entry, and nothing else', () => {
  const r = run({
    nodeResults: [
      ['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }, { container: 'redis', status: 'running', docker: {} }])],
    ],
    monitors: {
      1: { id: 1, name: 'Gitea', status: 'up', active: true },
      2: { id: 2, name: 'NAS UI', status: 'down', active: true },
      3: { id: 3, name: 'Network Switch', status: 'up', active: true },
      4: { id: 4, name: 'Pending', status: 'unknown', active: true },
    },
    lastSeen: { 2: 'vm103', 3: 'vm103' },
    containerRegistry: fakeRegistry([{ container: 'old', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 }]),
  });
  assert.deepEqual(r.monitorOf, { 'vm103:gitea': '1', 'vm103:NAS UI': '2', 'vm103:Network Switch': '3' });
  assert.ok(cards(r.nodes).some((s) => s.uid === 'vm103:old' && s.source === 'presence'), 'a breadcrumb carries none');
});

// ── where a down monitor's stopped container is drawn (#395) ──
//
// The container registry keeps one record per container name, with the last
// node in the pass: pi2 for vaultwarden, which runs on vm103 and pi2. The
// service registry has the node of the running card that had the monitor.
const VW_STOPPED = fakeRegistry([{ container: 'vaultwarden', lastSeenNode: 'pi2', lastSeenAt: 1000, ageMs: 120_000 }]);
const vwStopped = ({ status, lastSeen = 'vm103', config = { services: {} } }) =>
  run({
    nodeResults: VW_NODES.map((nodeKey) => [nodeKey, nodeCfg, nodeData([])]),
    monitors: vaultwarden(status),
    lastSeen: { 9: lastSeen },
    lastSeenContainer: { 9: 'vaultwarden' },
    containerRegistry: VW_STOPPED,
    config,
  });

test('assemble (#395): both copies of an unpinned replica stop: the red card is on the node the monitor last ran on', () => {
  const up = run({
    nodeResults: VW_NODES.map((nodeKey) => [nodeKey, nodeCfg, nodeData([])]),
    monitors: vaultwarden('up'),
    lastSeen: { 9: 'vm103' },
    lastSeenContainer: { 9: 'vaultwarden' },
  });
  const down = vwStopped({ status: 'down' });
  assert.deepEqual(monitoredUids(down.nodes), ['vm103:vaultwarden down'], "not pi2, the container registry's node");
  assert.equal(down.breadcrumbCount, 0, 'Kuma owns the stopped container');
  const back = vwStopped({ status: 'up' });
  assert.deepEqual(back.upWithoutCard, ['vm103:vaultwarden'], 'the up entry has the same uid');
  assert.deepEqual(pushes(up, down), ['service_down vm103:vaultwarden']);
  assert.deepEqual(pushes(down, back), ['service_recovered vm103:vaultwarden']);
  // With the monitor's last-seen node off the board, the stopped container's node, as before.
  assert.deepEqual(monitoredUids(vwStopped({ status: 'down', lastSeen: 'vm102' }).nodes), ['pi2:vaultwarden down']);
});

test('assemble (#395): a pinned replica, and a stopped container the monitor did not last run as, are drawn as before', () => {
  // Pinned to vm103: pi2's stopped copy gets no monitor, so the red card is on
  // the monitor's last-seen node, and pi2's copy leaves a breadcrumb.
  const config = { nodes: Object.fromEntries(VW_NODES.map((n) => [n, {}])), services: { vaultwarden: { monitor_per_node: { vm103: 'Vaultwarden' } } } };
  const pinned = vwStopped({ status: 'down', config });
  assert.deepEqual(monitoredUids(pinned.nodes), ['vm103:vaultwarden down']);
  assert.deepEqual(cards(pinned.nodes).filter((s) => s.source === 'presence').map((s) => s.uid), ['pi2:vaultwarden']);
  // Nextcloud last ran as vm103's nextcloud-app; an old nextcloud that stopped
  // on vm101 is the better match for the down monitor, so it is drawn there.
  const other = run({
    nodeResults: [
      ['vm101', nodeCfg, nodeData([])],
      ['vm103', nodeCfg, nodeData([{ container: 'nextcloud-app', status: 'running', docker: {} }])],
    ],
    monitors: { 3: { id: 3, name: 'Nextcloud', status: 'down', active: true } },
    lastSeen: { 3: 'vm103' },
    lastSeenContainer: { 3: 'nextcloud-app' },
    containerRegistry: fakeRegistry([{ container: 'nextcloud', lastSeenNode: 'vm101', lastSeenAt: 1000, ageMs: 120_000 }]),
  });
  assert.deepEqual(monitoredUids(other.nodes), ['vm101:nextcloud down']);
});

// ---- What the status model reads beside the payload (#290) ----

test('assemble: a running card whose monitor is pending or in maintenance keeps status unknown; kumaStatusOf names it', () => {
  const r = run({
    nodeResults: [['vm103', nodeCfg, nodeData([
      { container: 'gitea', status: 'running', docker: {} },
      { container: 'grafana', status: 'running', docker: {} },
      { container: 'loki', status: 'running', docker: {} },
    ])]],
    monitors: {
      1: { id: 1, name: 'gitea', status: 'unknown', kumaStatus: 'pending', active: true },
      2: { id: 2, name: 'grafana', status: 'unknown', kumaStatus: 'maintenance', active: true },
      3: { id: 3, name: 'loki', status: 'up', kumaStatus: 'up', active: true },
    },
  });
  const status = Object.fromEntries(r.nodes.vm103.services.map((s) => [s.container, s.status]));
  assert.deepEqual(status, { gitea: 'unknown', grafana: 'unknown', loki: 'up' });
  assert.deepEqual(r.kumaStatusOf, { 'vm103:gitea': 'pending', 'vm103:grafana': 'maintenance' });
  assert.deepEqual(r.kumaWithoutCard, {});
});

test('assemble: a pending or maintenance monitor with no container is placed after the up and down ones, taking none of their uids', () => {
  // Monitor 1 (pending) and monitor 2 (down) both last ran as `nextcloud`. The
  // down one keeps the uid it would have had without the pending one.
  const r = run({
    nodeResults: [['vm103', nodeCfg, nodeData([])]],
    monitors: {
      1: { id: 1, name: 'Nextcloud Cron', status: 'unknown', kumaStatus: 'pending', active: true },
      2: { id: 2, name: 'Nextcloud', status: 'down', kumaStatus: 'down', active: true },
      3: { id: 3, name: 'NAS', status: 'unknown', kumaStatus: 'maintenance', active: true },
    },
    lastSeen: { 1: 'vm103', 2: 'vm103', 3: 'vm103' },
    lastSeenContainer: { 1: 'nextcloud', 2: 'nextcloud' },
  });
  assert.equal(r.nodes.vm103.services.find((s) => s.status === 'down').uid, 'vm103:nextcloud');
  assert.deepEqual(r.kumaWithoutCard, { 'vm103:Nextcloud Cron': 'pending', 'vm103:NAS': 'maintenance' });
  assert.deepEqual(r.upWithoutCard, []);
  assert.equal(r.nodes.vm103.services.length, 1, 'neither draws a card');
});

test('assemble: a missing container that was a Kuma monitor’s last container is backedBy that monitor', () => {
  const r = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'Immich', status: 'up', active: true }, 2: { id: 2, name: 'gitea', status: 'up', active: true } },
    lastSeen: { 1: 'vm103', 2: 'vm103' },
    lastSeenContainer: { 1: 'immich-server', 2: 'gitea' },
    containerRegistry: fakeRegistry([
      { container: 'immich-server', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
      { container: 'immich-redis', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
    ]),
  });
  const presence = r.nodes.vm103.services.filter((s) => s.source === 'presence').map((s) => s.uid).sort();
  assert.deepEqual(presence, ['vm103:immich-redis', 'vm103:immich-server']);
  assert.deepEqual(r.backedBy, { 'vm103:immich-server': { monitor: 'Immich', status: 'up' } });
});

test('assemble (#438): backedBy carries Kuma’s status for the monitor, pending and maintenance included', () => {
  const backed = (monitor) =>
    run({
      nodeResults: [['vm103', nodeCfg, nodeData([])]],
      monitors: { 1: { id: 1, name: 'Immich', active: true, ...monitor } },
      lastSeen: { 1: 'vm103' },
      lastSeenContainer: { 1: 'immich-server' },
      containerRegistry: fakeRegistry([{ container: 'immich-server', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 }]),
    }).backedBy['vm103:immich-server']?.status;
  assert.equal(backed({ status: 'up', kumaStatus: 'up' }), 'up');
  assert.equal(backed({ status: 'unknown', kumaStatus: 'pending' }), 'pending');
  assert.equal(backed({ status: 'unknown', kumaStatus: 'maintenance' }), 'maintenance');
  assert.equal(backed({ status: 'unknown', kumaStatus: 'unknown' }), 'unknown');
  // Down, the stopped container holds the monitor: a red card, no grey one.
  assert.equal(backed({ status: 'down', kumaStatus: 'down' }), undefined);
});

test('assemble (#438): no grey breadcrumb on the uid of a down monitor’s red card', () => {
  // "Photos" doesn't match immich-server by name (its mapping is gone), so the
  // stopped container doesn't get it, and the red card is placed under the
  // container the monitor last ran as. The breadcrumb would share that uid.
  const r = run({
    nodeResults: [['vm103', nodeCfg, nodeData([])]],
    monitors: { 1: { id: 1, name: 'Photos', status: 'down', active: true } },
    lastSeen: { 1: 'vm103' },
    lastSeenContainer: { 1: 'immich-server' },
    containerRegistry: fakeRegistry([{ container: 'immich-server', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 }]),
  });
  assert.deepEqual(r.nodes.vm103.services.map((s) => `${s.uid} ${s.source} ${s.status}`), ['vm103:immich-server monitor down']);
  assert.equal(r.breadcrumbCount, 0);
  assert.deepEqual(r.backedBy, {});
  // Up, the monitor draws no card: the breadcrumb is back, on the up entry's uid.
  const up = run({
    nodeResults: [['vm103', nodeCfg, nodeData([])]],
    monitors: { 1: { id: 1, name: 'Photos', status: 'up', active: true } },
    lastSeen: { 1: 'vm103' },
    lastSeenContainer: { 1: 'immich-server' },
    containerRegistry: fakeRegistry([{ container: 'immich-server', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 }]),
  });
  assert.deepEqual(up.nodes.vm103.services.map((s) => `${s.uid} ${s.source}`), ['vm103:immich-server presence']);
  assert.deepEqual(up.upWithoutCard, ['vm103:immich-server']);
});

// ---- Display name and icon per node (#636) ----

const NPM_NAMES = {
  nodes: { pi1: {}, pi2: {} },
  services: {
    'gateway-npm': {
      display_name: 'Proxy',
      icon: 'npm',
      display_name_per_node: { pi1: 'NPM Primary' },
      icon_per_node: { pi1: 'npm-1' },
    },
  },
};
const piNpm = () => nodeData([{ container: 'gateway-npm', status: 'running', docker: {} }]);
const npmCard = (nodes, key) => nodes[key].services.find((s) => s.container === 'gateway-npm');

test('assemble (#636): a running container takes its node\'s name and icon, then the container-wide ones', () => {
  const { nodes } = run({ nodeResults: [['pi1', nodeCfg, piNpm()], ['pi2', nodeCfg, piNpm()]], monitors: {}, config: NPM_NAMES });
  assert.equal(npmCard(nodes, 'pi1').display_name, 'NPM Primary');
  assert.equal(npmCard(nodes, 'pi1').icon, 'npm-1');
  assert.equal(npmCard(nodes, 'pi2').display_name, 'Proxy');
  assert.equal(npmCard(nodes, 'pi2').icon, 'npm');
});

test('assemble (#636): with no override at all, the default name and no icon; blank per-node entries are ignored', () => {
  const config = { nodes: { pi1: {}, pi2: {} }, services: { 'gateway-npm': { display_name_per_node: { pi1: '' }, icon_per_node: { pi1: null } } } };
  const { nodes } = run({ nodeResults: [['pi1', nodeCfg, piNpm()], ['pi2', nodeCfg, piNpm()]], monitors: {}, config });
  assert.equal(npmCard(nodes, 'pi1').display_name, 'Gateway Npm');
  assert.equal(npmCard(nodes, 'pi1').icon, null);
});

test('assemble (#636): a down monitor\'s red card takes the name and icon of the node it lands on', () => {
  const { nodes } = run({
    nodeResults: [['pi1', nodeCfg, nodeData([])], ['pi2', nodeCfg, nodeData([])]],
    monitors: { 5: { id: 5, name: 'NPM Pi Primary', status: 'down', active: true } },
    lastSeen: { 5: 'pi1' },
    lastSeenContainer: { 5: 'gateway-npm' },
    config: NPM_NAMES,
  });
  const card = npmCard(nodes, 'pi1');
  assert.equal(card.source, 'monitor');
  assert.equal(card.display_name, 'NPM Primary');
  assert.equal(card.icon, 'npm-1');
});

test('assemble (#636): a stopped container remembered on a node takes that node\'s name', () => {
  const { nodes } = run({
    nodeResults: [['pi1', nodeCfg, nodeData([])], ['pi2', nodeCfg, nodeData([])]],
    monitors: {},
    containerRegistry: fakeRegistry([{ container: 'gateway-npm', lastSeenNode: 'pi2', lastSeenAt: 1000, ageMs: 120_000 }]),
    config: NPM_NAMES,
  });
  const card = npmCard(nodes, 'pi2');
  assert.equal(card.source, 'presence');
  assert.equal(card.display_name, 'Proxy');
  const onPi1 = run({
    nodeResults: [['pi1', nodeCfg, nodeData([])], ['pi2', nodeCfg, nodeData([])]],
    monitors: {},
    containerRegistry: fakeRegistry([{ container: 'gateway-npm', lastSeenNode: 'pi1', lastSeenAt: 1000, ageMs: 120_000 }]),
    config: NPM_NAMES,
  });
  assert.equal(npmCard(onPi1.nodes, 'pi1').display_name, 'NPM Primary');
});
