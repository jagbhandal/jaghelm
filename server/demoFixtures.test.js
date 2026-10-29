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
const { refreshUPS } = await import('./refresh.js');
const { refreshGitea } = await import('./gitea.js');
const { initMonitors, fetchMonitors } = await import('./monitors.js');
const { decodeBeats } = await import('./kumaBeats.js');
const { recordRun, getAllStatuses } = await import('./cron-store.js');
const { decorateStatuses } = await import('./cron-overdue.js');
const {
  demoNodeReadings,
  demoMonitors,
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

// ── Kuma monitors: monitors.js's shape ───────────────────────────────────

test('each demo monitor has the keys and value types fetchMonitors gives a live one', async () => {
  // A Kuma status page with one monitor and its heartbeats.
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const json = (body) =>
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/api/status-page/default')
      return json({ publicGroupList: [{ monitorList: [{ id: 7, name: 'Grafana' }] }] });
    if (url.pathname === '/api/status-page/heartbeat/default')
      return json({
        heartbeatList: { 7: [{ status: 1, ping: 38, time: '2026-10-19 11:59:40.000' }] },
        uptimeList: { '7_24': 0.9993 },
      });
    assert.fail(`unexpected request ${url}`);
  };
  initMonitors('http://kuma.demo.test');
  const { ok, monitors } = await fetchMonitors(true);
  assert.equal(ok, true);
  const live = monitors[7];
  assert.ok(live, 'the live monitor to compare with');

  for (const scenario of ['incident', 'healthy']) {
    for (const m of Object.values(demoMonitors(scenario, NOW))) {
      assert.deepEqual(keys(m), keys(live), `${m.name}: monitor keys`);
      for (const [k, v] of Object.entries(m)) {
        assert.equal(typeOf(v), typeOf(live[k]), `${m.name}.${k} is ${typeOf(v)}`);
      }
    }
  }
});

// ── Cron runs: cron-store's shape ────────────────────────────────────────

test('the demo cron statuses have the keys a live store gives, at every level', () => {
  // A live store (the test's own data dir), a failed and a good run with every field.
  const report = { job: 'probe', node: 'probe-node', duration_seconds: 4 };
  const extra = { schedule: 'daily 02:00', expected_every_seconds: 86_400 };
  recordRun({ ...report, ...extra, status: 'success' });
  recordRun({ ...report, ...extra, status: 'failure', error: 'repository is locked' });
  const [liveNode] = decorateStatuses(getAllStatuses(), NOW);
  const [liveJob] = liveNode.jobs;
  const [liveFailed, liveGood] = liveJob.runs;

  const demo = demoCronStatus({ scenario: 'incident', now: NOW });
  for (const node of demo) {
    assert.deepEqual(keys(node), keys(liveNode), `${node.node}: node keys`);
    for (const job of node.jobs) {
      assert.deepEqual(keys(job), keys(liveJob), `${node.node}/${job.job}: job keys`);
      for (const run of job.runs) {
        const live = run.status === 'failure' ? liveFailed : liveGood;
        assert.deepEqual(keys(run), keys(live), `${node.node}/${job.job}: ${run.status} run keys`);
        for (const [k, v] of Object.entries(run)) assert.equal(typeOf(v), typeOf(live[k]), k);
      }
    }
  }
});

// ── /api/services: assembleServices' output ──────────────────────────────

test('the incident board is down: one monitored service is down, every node is populated', () => {
  const board = demoServices({ scenario: 'incident', now: NOW });
  assert.deepEqual(keys(board), ['beats', 'nodes', 'overallHealth', 'sources']);
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

test("the heartbeat strips (#312): each monitored service's last 50 checks, every 30 s; the incident's outage", () => {
  for (const scenario of ['incident', 'healthy']) {
    const board = demoServices({ scenario, now: NOW });
    const cards = Object.values(board.nodes).flatMap((n) => n.services);
    assert.deepEqual(Object.keys(board.beats).sort(), cards.map((c) => c.uid).sort(), scenario);
    for (const [uid, encoded] of Object.entries(board.beats)) {
      const beats = decodeBeats(encoded);
      assert.equal(beats.length, 50, `${scenario} ${uid}`);
      assert.equal(beats.at(-1).time, NOW - 20_000, `${scenario} ${uid}: the newest 20 s ago`);
      assert.ok(beats.slice(1).every((b, i) => b.time - beats[i].time === 30_000), uid);
      const lit = beats.filter((b) => b.state === 'crit' || b.state === 'warn');
      // Healthy, no strip lights up; Backrest's maintenance stays quiet either way.
      if (scenario === 'healthy') assert.deepEqual(lit, [], `healthy ${uid}`);
    }
  }
  const incident = decodeBeats(demoServices({ scenario: 'incident', now: NOW }).beats['apps:jellyfin']);
  assert.deepEqual(
    incident.slice(-33).map((b) => b.state),
    ['warn', ...Array(32).fill('crit')],
    "Jellyfin's outage: a check pending, then 16 minutes down, its newest check the status"
  );
  assert.equal(incident[0].state, 'ok');
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

// ── /api/gitea/activity: what gitea.js serves for the same commits ───────

test('the demo Gitea payload is exactly what refreshGitea serves for those commits and runs', async () => {
  const demo = demoGiteaActivity({ now: NOW });
  const base = 'http://gitea.demo.test';
  // A repo with a CI word has Actions: its push runs, one per commit.
  const hasActions = (r) => r.commits.some((c) => c.ci);
  const RUN = {
    Passed: { status: 'completed', conclusion: 'success' },
    Failed: { status: 'completed', conclusion: 'failure' },
    Running: { status: 'in_progress', conclusion: null },
  };
  // Gitea's API answers for the same repos, commits and runs.
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const json = (body) =>
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/api/v1/repos/search') {
      // Listed oldest activity first: the payload sorts them itself.
      return json({
        data: [...demo].reverse().map((r) => ({
          name: r.repo,
          full_name: r.fullName,
          fork: false,
          mirror: false,
          archived: false,
          default_branch: 'main',
          has_actions: hasActions(r),
        })),
      });
    }
    const runsOf = demo.find((r) => url.pathname === `/api/v1/repos/${r.fullName}/actions/runs`);
    if (runsOf) {
      assert.ok(hasActions(runsOf), `runs asked of ${runsOf.repo}, which has no Actions`);
      return json({
        total_count: runsOf.commits.length,
        workflow_runs: runsOf.commits.map((c, i) => ({
          id: 100 - i,
          head_sha: c.sha.padEnd(40, '0'),
          head_branch: c.ref,
          event: 'push',
          path: `ci.yml@refs/heads/${c.ref}`,
          display_title: c.message,
          created_at: c.date,
          actor: { login: c.author, full_name: '' },
          ...RUN[c.ci.word],
        })),
      });
    }
    const repo = demo.find((r) => url.pathname === `/api/v1/repos/${r.fullName}/commits`);
    assert.ok(repo && !hasActions(repo), `unexpected request ${url}`);
    return json(
      repo.commits.map((c) => ({
        sha: c.sha.padEnd(40, '0'),
        commit: { message: `${c.message}\n\nDetails.`, author: { date: c.date, name: c.author } },
      }))
    );
  };
  const saved = process.env.JAGHELM_GITEA_URL;
  process.env.JAGHELM_GITEA_URL = base;
  try {
    assert.deepEqual(await refreshGitea(), demo);
    assert.ok(
      demo.some((r) => r.commits.some((c) => c.ci?.word === 'Failed')) &&
        demo.some((r) => !hasActions(r)),
      'the demo shows a failed run and a repo without Actions'
    );
  } finally {
    if (saved === undefined) delete process.env.JAGHELM_GITEA_URL;
    else process.env.JAGHELM_GITEA_URL = saved;
  }
});

// ── The rest ─────────────────────────────────────────────────────────────

test("the history (#311): the live route's shape, each node's last hour ending on its meter's reading", () => {
  const { status, body } = demoHistory({
    query: { series: 'node.cpu,node.memory,node.disk,node.temperature', range: '1h' },
    now: NOW,
  });
  assert.equal(status, 200);
  const board = demoServices({ now: NOW });
  const field = {
    'node.cpu': 'cpu',
    'node.memory': 'memPercent',
    'node.disk': 'diskPercent',
    'node.temperature': 'temp',
  };
  for (const s of body.series) {
    assert.deepEqual(
      [s.ok, s.count, s.stepMs, s.startMs],
      [true, 61, 60_000, NOW - 3_600_000],
      s.series
    );
    // Every node with the reading has a line; the one without a sensor has none.
    const withReading = NODE_KEYS.filter((k) => board.nodes[k].metrics[field[s.series]] != null);
    assert.deepEqual(
      s.lines.map((l) => l.entity),
      withReading,
      s.series
    );
    for (const line of s.lines) {
      assert.equal(line.values.length, 61);
      assert.ok(
        line.values.every((v) => Number.isFinite(v) && v >= 0),
        `${s.series} ${line.entity}`
      );
      assert.equal(line.values.at(-1), Number(board.nodes[line.entity].metrics[field[s.series]]));
    }
  }
});

test("the history's container lines, ranges and refusals are the live route's", () => {
  const box = demoHistory({
    query: { series: 'container.cpu,container.memory', entity: 'apps/jellyfin', range: '7d' },
    now: NOW,
  });
  assert.equal(box.status, 200);
  const [cpu, memory] = box.body.series;
  assert.deepEqual([cpu.unit, cpu.count, memory.unit], ['%', 337, 'bytes']);
  assert.ok(memory.lines[0].values.every((v) => Number.isInteger(v) && v > 100 * 1024 * 1024));
  // Repeatable: the same answer for the same time.
  assert.deepEqual(
    demoHistory({
      query: { series: 'container.cpu', entity: 'apps/jellyfin', range: '7d' },
      now: NOW,
    }).body.series[0],
    cpu
  );
  assert.equal(
    demoHistory({
      query: { series: 'container.cpu', entity: 'apps/nothing', range: '1h' },
      now: NOW,
    }).status,
    404
  );
  assert.equal(demoHistory({ query: { series: 'node.cpu', range: '2h' } }).status, 400);
  assert.equal(demoHistory({ query: { series: 'node.load', range: '1h' } }).status, 400);
  assert.equal(demoHistory({ query: { series: 'container.cpu', range: '1h' } }).status, 400);
  assert.equal(
    demoHistory({ query: { series: 'node.cpu', entity: 'pi9', range: '1h' } }).status,
    404
  );
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

test("the display config has Quick Launch links in the groups the panel shows, and none of the old board's keys", () => {
  const cfg = demoDisplayConfig();
  for (const key of ['gridLayout', 'gridColumns', 'showCronJobs'])
    assert.ok(!Object.hasOwn(cfg, key), key);
  for (const group of ['personal', 'management', 'devops']) {
    assert.ok(cfg.links[group].length > 0, group);
    for (const l of cfg.links[group]) assert.match(l.url, /^https:\/\/[a-z]+\.example\.com$/);
  }
});

test('demoMonitorMapping: the demo board has monitors attached, each suggestion has a reason (#319)', async () => {
  const { demoMonitorMapping } = await import('./demoFixtures.js');
  const { services } = demoMonitorMapping({ scenario: 'healthy', now: NOW });
  const entries = Object.values(services);
  assert.ok(entries.some((e) => typeof e.attached === 'string'));
  for (const e of entries) assert.equal(e.suggested === null, e.why === null);
});

// ── Drives (#727) ────────────────────────────────────────────────────────

test('demoDrives: the records have the keys and types drives.js gives for real exporter output', async () => {
  const { demoDrives } = await import('./demoFixtures.js');
  const { createDrivesCache } = await import('./drives.js');
  const { resolveEntity } = await import('./promHistory.js');
  const { smartctlProm, smartctlText } = await import('./testing/smartctlProm.js');

  const config = { nodes: { nas: {}, pve: {} } };
  const { matcher } = resolveEntity({ kind: 'node', entity: null }, config);
  const prom = smartctlProm({
    nodes: {
      nas: { text: smartctlText('smartctl-nas.metrics') },
      pve: { text: smartctlText('smartctl-pve.metrics') },
    },
    matcher,
  });
  const live = await createDrivesCache({ query: prom.query, logger: { warn() {}, info() {} } }).read(config);
  const liveHdd = live.nodes.nas.drives[0];
  const liveNvme = live.nodes.pve.drives[0];
  assert.deepEqual(Object.keys(live.nodes.nas), ['devices', 'scrapeUp', 'drives']);

  const demo = demoDrives({ scenario: 'incident' });
  assert.equal(demo.enabled, true);
  assert.deepEqual(Object.keys(demo.nodes), ['storage'], 'on a node the demo board has');
  assert.deepEqual(Object.keys(demo.nodes.storage), ['devices', 'scrapeUp', 'drives']);
  assert.equal(demo.nodes.storage.devices, demo.nodes.storage.drives.length);
  for (const d of demo.nodes.storage.drives) {
    const real = d.type === 'nvme' ? liveNvme : liveHdd;
    assert.deepEqual(Object.keys(d).sort(), Object.keys(real).sort(), d.device);
    // Where both have a value, the same kind of value (an NVMe has no sector counts, a SATA drive no spare).
    for (const [k, v] of Object.entries(d)) {
      if (v !== null && real[k] !== null) assert.equal(typeof v, typeof real[k], `${d.device}.${k}`);
    }
  }
  // An NVMe and a few HDDs, and only in the incident one in trouble.
  const types = demo.nodes.storage.drives.map((d) => d.type).sort();
  assert.deepEqual(types, ['hdd', 'hdd', 'hdd', 'nvme']);
  const grew = (scenario) =>
    demoDrives({ scenario }).nodes.storage.drives.filter((d) =>
      Object.values(d.sectors ?? {}).some((s) => s.grew)
    );
  assert.deepEqual(grew('incident').map((d) => d.device), ['sdb']);
  assert.deepEqual(grew('healthy'), []);
  assert.ok(!/serial/i.test(JSON.stringify(demo)));
});
