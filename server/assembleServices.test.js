// server/assembleServices.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { assembleServices } from './refresh.js';
import { createContainerRegistry } from './containerRegistry.js';

const nodeCfg = { display_name: 'Production' };
function nodeData(containers) { return { metrics: {}, containers }; }

// A fake container registry: no-op record, returns a fixed missing list.
function fakeRegistry(missing = []) {
  return { recordSeen() {}, getMissing() { return missing; } };
}

function run({ nodeResults, monitors, lastSeen = {}, containerRegistry = null, now = () => 0 }) {
  return assembleServices({
    nodeResults,
    monitors,
    config: { services: {} },
    lastSeenNodeOf: (id) => lastSeen[String(id)] ?? null,
    containerRegistry,
    now,
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

test('assemble: seen[] reports matched (monitorId, node) pairs for the registry', () => {
  const { seen } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'gitea', status: 'up', active: true } },
  });
  assert.deepEqual(seen, [{ monitorId: 1, nodeKey: 'vm103' }]);
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

test('assemble: a vanished container that MATCHES a monitor is NOT a breadcrumb (Kuma owns it)', () => {
  const { nodes, breadcrumbCount } = run({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'postgres', status: 'up', active: true } },
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
    ]),
  });
  assert.equal(nodes.vm103.services.some((s) => s.container === 'postgres' && s.source === 'presence'), false);
  assert.equal(breadcrumbCount, 0);
});

test('assemble: a vanished container mapped to a monitor via EXPLICIT override is NOT a breadcrumb (Kuma owns it)', () => {
  // 'pgmon' does NOT fuzzy-match 'postgres'; only the explicit
  // config.services.postgres.monitor mapping links them. The breadcrumb guard
  // must honor that override (mirror the running-card path) — else a tracked
  // service leaks out as a grey breadcrumb.
  const { nodes, breadcrumbCount } = assembleServices({
    nodeResults: [['vm103', nodeCfg, nodeData([{ container: 'gitea', status: 'running', docker: {} }])]],
    monitors: { 1: { id: 1, name: 'pgmon', status: 'up', active: true } },
    config: { services: { postgres: { monitor: 'pgmon' } } },
    lastSeenNodeOf: () => null,
    containerRegistry: fakeRegistry([
      { container: 'postgres', lastSeenNode: 'vm103', lastSeenAt: 1000, ageMs: 120_000 },
    ]),
    now: () => 0,
  });
  assert.equal(nodes.vm103.services.some((s) => s.container === 'postgres'), false);
  assert.equal(breadcrumbCount, 0);
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
