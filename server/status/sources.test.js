/**
 * Source-down fixtures (#290 acceptance, spec §6): the homelab-shaped board
 * (push/fixtures/liveShape.js), assembled by the real assembleServices and read
 * through readStatusInputs as the live server would, then one monitoring
 * source fails. Each yields zero crit entities and exactly one source issue:
 * the entities that source feeds go unknown, naming it, and nothing pages red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONTAINERS, NODE_ORDER, NOW, liveCycle } from '../push/fixtures/liveShape.js';
import { assembleServices, noNodesCacheEntry } from '../refresh.js';
import { createStatusTracker, readStatusInputs } from './index.js';
import { DEFAULT_THRESHOLDS } from './thresholds.js';
import { sourceUrl } from '../sourceUrls.js';

const UPS = {
  status: 1,
  charge: 100,
  runtime: 3600,
  load: 20,
  ok: true,
  configured: true,
  model: 'Back-UPS',
};
const CRON = [
  {
    node: 'vm103',
    jobs: [
      {
        job: 'restic-backup',
        runs: [{ status: 'success', timestamp: new Date(NOW - 3_600_000).toISOString() }],
      },
    ],
  },
];
const INTEGRATIONS = {
  sonarr: {
    Queue: '0',
    _preset: 'sonarr',
    _status: { state: 'ok', since: NOW - 1, failures: 0, nextAttemptAt: null },
  },
};

/** The caches after one services refresh that assembled `r`. */
function caches(r, { prometheusOk = true, kumaOk = true, ups = UPS, sourceErrors = {} } = {}) {
  const services = {
    nodes: r.nodes,
    overallHealth: r.overallHealth,
    sources: { prometheus: { ok: prometheusOk }, kuma: { ok: kumaOk } },
  };
  const internal = {
    upWithoutCard: r.upWithoutCard,
    monitorOf: r.monitorOf,
    kumaStatusOf: r.kumaStatusOf,
    kumaWithoutCard: r.kumaWithoutCard,
    backedBy: r.backedBy,
    sourceErrors,
  };
  return {
    getCached: (key) => ({ services, ups, integrations: INTEGRATIONS })[key] ?? null,
    getCachedInternal: (key) => (key === 'services' ? internal : null),
    getAllCronStatuses: () => CRON,
  };
}

/** Runs the tracker over the cycles' caches, 30 s apart. */
function run(cycleCaches) {
  const tracker = createStatusTracker();
  return cycleCaches.map((c, i) =>
    tracker.update({
      inputs: readStatusInputs(c, { env: { KUMA_URL: 'http://kuma' } }),
      thresholds: DEFAULT_THRESHOLDS,
      now: NOW + i * 30_000,
    })
  );
}

const crits = (s) => s.entities.filter((e) => e.state === 'crit').map((e) => e.id);
const sourceIssues = (s) => s.issues.filter((i) => i.kind === 'source').map((i) => i.id);

test('the healthy homelab board: all ok, no issues, a quiet line', () => {
  const [s] = run([caches(liveCycle())]);
  assert.equal(s.overall.state, 'ok');
  assert.deepEqual(s.issues, []);
  assert.match(s.overall.sentence, /^All \d+ services up · 4 nodes healthy$/);
  assert.deepEqual(Object.keys(s.sources).sort(), ['kuma', 'nut', 'prometheus']);
});

test('source down: Prometheus fails outright, no node read at all', () => {
  const healthy = caches(liveCycle());
  // The refresh's node batch threw: no node in the payload, nothing placed.
  const down = assembleServices({
    nodeResults: [],
    monitors: [],
    config: { nodes: {}, services: {} },
    lastSeenNodeOf: () => null,
    containerRegistry: null,
    now: () => NOW,
    presenceKnown: false,
  });
  const [before, after] = run([
    healthy,
    caches(down, {
      prometheusOk: false,
      ups: { ...UPS, status: null, charge: null, ok: false, configured: null, model: null },
      sourceErrors: { prometheus: 'Prometheus query failed: fetch failed' },
    }),
  ]);
  assert.deepEqual(crits(after), []);
  assert.deepEqual(sourceIssues(after), ['sources/prometheus']);
  assert.equal(after.issues[0].reason, 'Prometheus query failed: fetch failed');
  // Everything it fed is still there, as no signal, not gone and not red.
  assert.equal(after.entities.length, before.entities.length);
  for (const e of after.entities.filter(
    (x) => ['nodes', 'power'].includes(x.subsystem) || x.kind === 'container'
  )) {
    assert.equal(e.state, 'unknown', e.id);
    assert.equal(e.reason, 'No data: Prometheus unreachable', e.id);
  }
  assert.equal(after.overall.state, 'warn');
  assert.match(after.overall.sentence, /^Prometheus unreachable · \d+ no signal$/);
  assert.equal(after.sources.nut.state, 'ok', 'NUT is not blamed for Prometheus');
});

test('source down: Prometheus answers with no up series (every read failed)', () => {
  const nodeResults = NODE_ORDER.map((nodeKey) => [
    nodeKey,
    { display_name: nodeKey },
    {
      metrics: { cpu: null, memPercent: null, diskPercent: null, temp: null },
      reachable: null,
      failedReads: ['containers', 'cpu', 'disk', 'mem', 'reachable', 'temp', 'uptime'],
      containers: [],
    },
  ]);
  const down = assembleServices({
    nodeResults,
    monitors: [],
    config: { nodes: Object.fromEntries(NODE_ORDER.map((k) => [k, {}])), services: {} },
    lastSeenNodeOf: () => null,
    containerRegistry: null,
    now: () => NOW,
    presenceKnown: false,
  });
  const [before, after] = run([caches(liveCycle()), caches(down, { prometheusOk: false })]);
  assert.deepEqual(crits(after), []);
  assert.deepEqual(sourceIssues(after), ['sources/prometheus']);
  for (const k of NODE_ORDER)
    assert.equal(after.entities.find((e) => e.id === `nodes/${k}`).state, 'unknown');
  const containers = (s) => s.entities.filter((e) => e.kind === 'container');
  assert.ok(containers(before).length > 20);
  assert.deepEqual(
    containers(after).map((e) => e.id),
    containers(before).map((e) => e.id),
    'kept, not dropped'
  );
  assert.ok(containers(after).every((e) => e.state === 'unknown'));
});

test('source down: Kuma fails while a service was down, past the stale ceiling', () => {
  const before = caches(liveCycle({ status: { Gitea: 'down' } }));
  // Kuma's last statuses are past their ceiling: no monitors, so no card is monitored.
  const after = caches(assembleNoKuma(), {
    kumaOk: false,
    sourceErrors: { kuma: 'Kuma status page answered HTTP 502' },
  });
  const [s1, s2] = run([before, after]);
  assert.deepEqual(crits(s1), ['services/vm103:gitea']);
  assert.deepEqual(crits(s2), [], 'a service Kuma last saw down is no signal, not crit');
  assert.deepEqual(sourceIssues(s2), ['sources/kuma']);
  const gitea = s2.entities.find((e) => e.id === 'services/vm103:gitea');
  assert.deepEqual(
    [gitea.kind, gitea.state, gitea.reason],
    ['service', 'unknown', 'No data: Kuma unreachable']
  );
  // Nodes and containers Prometheus reads are still judged.
  assert.ok(s2.entities.filter((e) => e.subsystem === 'nodes').every((e) => e.state === 'ok'));
});

/** The live board assembled with no monitors (Kuma gave none). */
function assembleNoKuma() {
  const nodeResults = NODE_ORDER.map((nodeKey) => [
    nodeKey,
    { display_name: 'Node', hide: ['cadvisor', 'node-exporter', 'prometheus'] },
    {
      metrics: { cpu: '12.5', memPercent: '41.0', diskPercent: '63.0' },
      reachable: true,
      failedReads: [],
      containers: CONTAINERS[nodeKey].map((container) => ({
        container,
        status: 'running',
        docker: {},
      })),
    },
  ]);
  return assembleServices({
    nodeResults,
    monitors: [],
    config: { nodes: Object.fromEntries(NODE_ORDER.map((k) => [k, {}])), services: {} },
    lastSeenNodeOf: () => null,
    containerRegistry: null,
    now: () => NOW,
  });
}

test('source down: Kuma fails within the stale ceiling (its last statuses still on the cards)', () => {
  const stale = liveCycle({ status: { Gitea: 'down', 'NAS (Ping)': 'down' } });
  const [s] = run([caches(stale, { kumaOk: false })]);
  assert.deepEqual(crits(s), []);
  assert.deepEqual(sourceIssues(s), ['sources/kuma']);
  assert.ok(s.entities.filter((e) => e.kind === 'service').every((e) => e.state === 'unknown'));
});

test('source down: the NUT exporter goes quiet', () => {
  const [, s] = run([
    caches(liveCycle()),
    caches(liveCycle(), { ups: { ...UPS, status: null, charge: null, runtime: null, load: null } }),
  ]);
  assert.deepEqual(crits(s), []);
  assert.deepEqual(sourceIssues(s), ['sources/nut']);
  const ups = s.entities.find((e) => e.id === 'power/ups');
  assert.deepEqual([ups.state, ups.reason], ['unknown', 'No data: NUT exporter not reporting']);
});

test('a source that recovers: its issue goes, its entities are judged again', () => {
  const healthy = caches(liveCycle());
  const down = caches(assembleNoKuma(), { kumaOk: false });
  const [, during, after] = run([healthy, down, healthy]);
  assert.deepEqual(sourceIssues(during), ['sources/kuma']);
  assert.deepEqual(after.issues, []);
  assert.equal(after.overall.state, 'ok');
  assert.equal(after.sources.kuma.state, 'ok');
  assert.equal(after.sources.kuma.since, NOW + 60_000, 'since: when it recovered');
});

// ── The config as a source (#505) ────────────────────────────────────────

/** Runs the tracker over [caches, configProblem] cycles, 30 s apart. */
function runWithConfig(cycles, env = { KUMA_URL: 'http://kuma' }) {
  const tracker = createStatusTracker();
  return cycles.map(([c, configProblem], i) =>
    tracker.update({
      inputs: readStatusInputs(c, { env, configProblem }),
      thresholds: DEFAULT_THRESHOLDS,
      now: NOW + i * 30_000,
    })
  );
}

const BROKEN = "services.yaml doesn't parse (line 4)";

test("#505: a services.yaml that doesn't parse is a failed source, its own issue, named in the sentence; the board under it is judged as before", () => {
  const board = caches(liveCycle({ status: { Gitea: 'down' } }));
  const [good, broken] = runWithConfig([
    [board, null],
    [board, BROKEN],
  ]);
  assert.deepEqual(broken.sources.config, { state: 'failed', error: BROKEN, since: NOW + 30_000 });
  assert.deepEqual(sourceIssues(broken), ['sources/config']);
  const issue = broken.issues.find((i) => i.id === 'sources/config');
  assert.deepEqual(
    [issue.kind, issue.subsystem, issue.name, issue.state, issue.word, issue.reason],
    ['source', 'sources', 'JagHelm config', 'warn', 'Failed', BROKEN]
  );
  assert.equal(broken.overall.state, 'crit', 'the down service is still the worst');
  assert.equal(broken.overall.sentence, `1 service down · ${BROKEN}`);
  assert.deepEqual(broken.entities, good.entities, 'every entity judged as before');
  assert.deepEqual(broken.subsystems, good.subsystems);
});

test('#505: a good services.yaml lists no config source, and its issue goes once the file is fixed', () => {
  const board = caches(liveCycle());
  const [s1, s2, s3] = runWithConfig([
    [board, null],
    [board, BROKEN],
    [board, null],
  ]);
  assert.deepEqual(Object.keys(s1.sources).sort(), ['kuma', 'nut', 'prometheus']);
  assert.equal(s2.overall.state, 'warn');
  assert.equal(s2.overall.sentence, BROKEN);
  assert.deepEqual(s3, s1, 'fixed: the board is as it was');
});

test('#505: at boot on a broken file (no nodes, so an empty board) the board is not "Nothing monitored yet" but says the file is broken', () => {
  const { payload, internal } = noNodesCacheEntry({ prometheusOk: true });
  const noNodes = {
    getCached: (key) =>
      ({ services: payload, ups: { ok: true, configured: false }, integrations: {} })[key] ?? null,
    getCachedInternal: (key) => (key === 'services' ? internal : null),
    getAllCronStatuses: () => [],
  };
  // No Kuma, no Gitea: nothing set up.
  const [empty] = runWithConfig([[noNodes, null]], {});
  assert.equal(empty.overall.state, 'empty');
  const [broken] = runWithConfig([[noNodes, "services.yaml doesn't parse"]], {});
  assert.deepEqual(broken.overall, { state: 'warn', sentence: "services.yaml doesn't parse" });
  assert.deepEqual(broken.issues.map((i) => i.id), ['sources/config']);
});

// ── A source URL refused at boot (#419) ──────────────────────────────────

for (const [name, variable, label, value] of [
  ['prometheus', 'PROMETHEUS_URL', 'Prometheus', 'http://jag:hunter2@prom:9090'], // pragma: allowlist secret
  ['kuma', 'KUMA_URL', 'Kuma', 'http://jag:1234#hunter2@kuma'], // pragma: allowlist secret
  ['gitea', 'GITEA_URL', 'Gitea', 'http://jag:1234/hunter2@git'], // pragma: allowlist secret
]) {
  test(`#419: a ${variable} with a password is its source off, one issue naming the variable, whatever its refresh said`, () => {
    const env = { KUMA_URL: 'http://kuma', [variable]: value };
    const { problem } = sourceUrl(name, env);
    const [good] = runWithConfig([[caches(liveCycle()), null]]);
    const [off] = runWithConfig([[caches(liveCycle()), null]], env);
    assert.deepEqual(off.sources[name], { state: 'failed', error: problem, since: NOW });
    assert.deepEqual(sourceIssues(off), [`sources/${name}`]);
    const issue = off.issues.find((i) => i.id === `sources/${name}`);
    assert.deepEqual(
      [issue.kind, issue.subsystem, issue.name, issue.state, issue.word, issue.reason],
      ['source', 'sources', label, 'warn', 'Off', problem]
    );
    assert.equal(off.overall.state, 'warn');
    assert.equal(off.overall.sentence, `${label} off`);
    assert.deepEqual(off.entities, good.entities, 'the board under it is judged as before');
    assert.ok(!JSON.stringify(off).includes('hunter2'));
  });
}

test('#419: at boot with no nodes (Kuma is not read), a refused KUMA_URL is still its source off, not an empty board', () => {
  const { payload, internal } = noNodesCacheEntry({ prometheusOk: true });
  const noNodes = {
    getCached: (key) =>
      ({ services: payload, ups: { ok: true, configured: false }, integrations: {} })[key] ?? null,
    getCachedInternal: (key) => (key === 'services' ? internal : null),
    getAllCronStatuses: () => [],
  };
  const env = { KUMA_URL: 'http://jag:hunter2@kuma' }; // pragma: allowlist secret
  const [off] = runWithConfig([[noNodes, null]], env);
  assert.deepEqual(off.overall, { state: 'warn', sentence: 'Kuma off' });
  assert.deepEqual(off.issues.map((i) => [i.id, i.reason]), [['sources/kuma', sourceUrl('kuma', env).problem]]);
});
