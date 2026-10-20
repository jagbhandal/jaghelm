/**
 * The demo's fixtures (#248) keep the live server's shapes, so the demo can't
 * drift into a stale shape again: the parts written by hand are checked
 * against what the live code gives for the same input, and the rest is built
 * by the live code itself (assembleServices, decorateStatuses).
 *
 * Runs in its own process (node:test spawns per file): it points discovery at
 * a mock Prometheus and swaps the global fetch.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { createMockPrometheus, homelabSeries } from './testing/mockPrometheus.js';

const { initDiscovery, getNodesData } = await import('./discovery.js');
const { refreshUPS, refreshGitea } = await import('./refresh.js');
const {
  demoNodeReadings,
  demoServices,
  demoServicesConfig,
  demoMonitorNames,
  demoHistory,
  demoUps,
  demoGiteaActivity,
  demoCronStatus,
  demoDisplayConfig,
} = await import('./demoFixtures.js');

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const NOW = Date.parse('2026-10-19T12:00:00Z');
const NODE_KEYS = ['edge', 'apps', 'storage'];
const keys = (o) => Object.keys(o).sort();
const typeOf = (v) => (v === null ? 'null' : typeof v);

// ── Node readings: discovery's shape ─────────────────────────────────────

test('each demo node reading has the keys and value types discovery gives a live node', async () => {
  const { labels, series } = homelabSeries({ nodes: 6 });
  const mock = createMockPrometheus(series);
  initDiscovery(mock.url);
  globalThis.fetch = mock.fetch;
  const live = (await getNodesData(labels)).get(labels[0]);
  const liveContainer = live.containers[0];
  assert.ok(liveContainer, 'the live node has a container to compare with');

  const demo = demoNodeReadings();
  assert.deepEqual(Object.keys(demo), NODE_KEYS);
  for (const [key, node] of Object.entries(demo)) {
    assert.deepEqual(keys(node), keys(live), `${key}: node keys`);
    assert.deepEqual(keys(node.metrics), keys(live.metrics), `${key}: metric keys`);
    for (const [m, v] of Object.entries(node.metrics)) {
      // buildMetrics formats every reading as a string, or null without one.
      assert.ok(['string', 'null'].includes(typeOf(v)), `${key}.metrics.${m} is ${typeOf(v)}`);
    }
    for (const c of node.containers) {
      assert.deepEqual(keys(c), keys(liveContainer), `${key}/${c.container}: container keys`);
      assert.deepEqual(
        keys(c.docker),
        keys(liveContainer.docker),
        `${key}/${c.container}: docker keys`
      );
      for (const f of ['cpu', 'memMB', 'rxMB', 'txMB', 'rxBytesPerSec', 'txBytesPerSec']) {
        assert.equal(typeof c.docker[f], 'number', `${key}/${c.container}: docker.${f}`);
      }
    }
  }
});

// ── /api/services: assembleServices' output ──────────────────────────────

test('the incident board is down: one monitored service is down, every node is populated', () => {
  const board = demoServices({ scenario: 'incident', now: NOW });
  assert.deepEqual(keys(board), ['nodes', 'overallHealth', 'sources']);
  assert.equal(board.overallHealth, 'down');
  assert.deepEqual(Object.keys(board.nodes), NODE_KEYS);

  const cards = Object.values(board.nodes).flatMap((n) => n.services);
  const down = cards.filter((s) => s.status === 'down').map((s) => s.uid);
  assert.deepEqual(down, ['apps:jellyfin']);
  // Ordered down first, as on a live board.
  assert.equal(board.nodes.apps.services[0].uid, 'apps:jellyfin');
  for (const [key, node] of Object.entries(board.nodes)) {
    assert.ok(node.services.length >= 3, `${key} has services`);
    assert.equal(node.reachable, true);
    assert.ok(
      node.metrics.cpu && node.metrics.memPercent && node.metrics.diskPercent,
      `${key} has metrics`
    );
    // The helpers every node runs are hidden by the `hide` list a first boot writes.
    for (const helper of ['prometheus', 'node-exporter', 'cadvisor']) {
      assert.ok(!node.services.some((s) => s.container === helper), `${key} hides ${helper}`);
    }
  }
  // Every service shown has its Kuma monitor: no "unmonitored" card in the demo.
  assert.deepEqual(
    cards.filter((s) => !s.monitored).map((s) => s.uid),
    []
  );
});

test('the healthy board is up', () => {
  const board = demoServices({ scenario: 'healthy', now: NOW });
  assert.equal(board.overallHealth, 'up');
  const cards = Object.values(board.nodes).flatMap((n) => n.services);
  assert.ok(cards.length > 10);
  assert.ok(cards.every((s) => s.status === 'up'));
});

test('the services config is what a first boot generates for these nodes, named', () => {
  const cfg = demoServicesConfig();
  assert.deepEqual(Object.keys(cfg.nodes), NODE_KEYS);
  for (const [key, node] of Object.entries(cfg.nodes)) {
    assert.equal(node.prometheus_node, key);
    assert.deepEqual(node.hide, ['prometheus', 'node-exporter', 'cadvisor']);
    assert.notEqual(node.display_name, key, 'named');
  }
  assert.deepEqual(demoMonitorNames(), [...demoMonitorNames()].sort());
});

// ── /api/ups: what refresh.js serves for the same UPS ────────────────────

test('the demo UPS payload is exactly what refreshUPS serves for that UPS', async () => {
  const ups = demoUps();
  const target = { ups: 'apcups', instance: 'ups:9199', job: 'nut' };
  const series = [
    ['nut_status', ups.status],
    ['nut_battery_charge', ups.charge / 100],
    ['nut_battery_runtime_seconds', ups.runtime],
    ['nut_load', ups.load / 100],
  ].map(([name, value]) => ({ labels: { __name__: name, ...target }, value }));
  series.push({
    labels: { __name__: 'nut_ups_info', ...target, description: ups.model },
    value: 1,
  });
  const mock = createMockPrometheus(series);
  initDiscovery(mock.url);
  globalThis.fetch = mock.fetch;

  assert.deepEqual(await refreshUPS(), ups);
});

// ── /api/gitea/activity: what refresh.js serves for the same commits ─────

test('the demo Gitea payload is exactly what refreshGitea serves for those commits', async () => {
  const demo = demoGiteaActivity({ now: NOW });
  const base = 'http://gitea.demo.test';
  // Gitea's API answers for the same repos and commits.
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const json = (body) =>
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/api/v1/repos/search') {
      // Listed oldest activity first: the payload sorts them itself.
      return json({
        data: [...demo]
          .reverse()
          .map((r) => ({
            name: r.repo,
            full_name: r.fullName,
            fork: false,
            mirror: false,
            archived: false,
          })),
      });
    }
    const repo = demo.find((r) => url.pathname === `/api/v1/repos/${r.fullName}/commits`);
    assert.ok(repo, `unexpected request ${url}`);
    return json(
      repo.commits.map((c) => ({
        sha: c.sha.padEnd(40, '0'),
        commit: { message: `${c.message}\n\nDetails.`, author: { date: c.date, name: c.author } },
      }))
    );
  };
  const saved = process.env.GITEA_URL;
  process.env.GITEA_URL = base;
  try {
    assert.deepEqual(await refreshGitea(), demo);
  } finally {
    if (saved === undefined) delete process.env.GITEA_URL;
    else process.env.GITEA_URL = saved;
  }
});

// ── The rest ─────────────────────────────────────────────────────────────

test('the history has an hour of samples per node reading, keyed as history.js keys them', () => {
  const history = demoHistory();
  assert.deepEqual(
    keys(history),
    NODE_KEYS.flatMap((k) => [`${k}:cpu`, `${k}:mem`, `${k}:disk`]).sort()
  );
  const board = demoServices({ now: NOW });
  for (const [key, samples] of Object.entries(history)) {
    assert.equal(samples.length, 60, key);
    assert.ok(
      samples.every((v) => Number.isFinite(v) && v >= 0 && v <= 100),
      key
    );
    // The last sample is the reading the node panel shows.
    const [node, metric] = key.split(':');
    const field = { cpu: 'cpu', mem: 'memPercent', disk: 'diskPercent' }[metric];
    assert.equal(samples.at(-1), Number(board.nodes[node].metrics[field]), key);
  }
});

test('scheduled jobs: the incident has the backup failed, the healthy run has none, nothing is overdue', () => {
  const incident = demoCronStatus({ scenario: 'incident', now: NOW });
  const healthy = demoCronStatus({ scenario: 'healthy', now: NOW });
  const latest = (statuses) =>
    statuses.flatMap((n) => n.jobs.map((j) => [`${n.node}/${j.job}`, j.runs[0].status]));
  assert.deepEqual(
    latest(incident).filter(([, s]) => s !== 'success'),
    [['storage/nightly-backup', 'failure']]
  );
  assert.deepEqual(
    latest(healthy).filter(([, s]) => s !== 'success'),
    []
  );
  for (const job of incident.flatMap((n) => n.jobs)) {
    assert.equal(job.overdue, false, job.job);
    assert.equal(typeof job.seconds_since_report, 'number', job.job);
  }
});

test('the display config has Quick Launch links in the groups the panel shows, and no saved layout', () => {
  const cfg = demoDisplayConfig();
  assert.equal(cfg.gridLayout, null);
  for (const group of ['personal', 'management', 'devops']) {
    assert.ok(cfg.links[group].length > 0, group);
    for (const l of cfg.links[group]) assert.match(l.url, /^https:\/\/[a-z]+\.example\.com$/);
  }
});
