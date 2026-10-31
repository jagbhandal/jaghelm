/**
 * Restarts and OOM kills (#761, containerEvents.js): the events out of
 * Prometheus-shaped sample answers (recorded from the Grafana panel's
 * expressions on the lab: a recreated container, a `docker restart`, an OOM
 * kill), the gaps that are not "no restarts", and the restart-loop count.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENT_KINDS,
  MAX_EVENTS,
  RESTART_LOOP_WINDOW_MS,
  eventQueries,
  eventsOf,
  readContainerEvents,
  readRecentContainerEvents,
  restartLoops,
} from './containerEvents.js';

const CONFIG = { nodes: { pve: {}, nas: { prometheus_node: 'storage-box' }, old: { visible: false } } };
// A 24 h grid at 300 s ending 2026-10-29 12:00 UTC.
const END = Date.UTC(2026, 9, 29, 12) / 1000;
const SPAN = { start: END - 86_400, end: END, step: 300 };
const at = (i) => SPAN.start + i * SPAN.step;

// Samples as promQueryRange returns them: [seconds, 'value'].
const SAMPLE = {
  // jellyfin on pve was recreated 100 s before the step at index 40 saw it.
  recreated: [{ metric: { node: 'pve', name: 'jellyfin' }, values: [[at(40), '100']] }],
  // sonarr on pve: counter reset at step 100 (a plain restart). jellyfin: reset in the same step it was recreated.
  reset: [
    { metric: { node: 'pve', name: 'sonarr' }, values: [[at(100), '1']] },
    { metric: { node: 'pve', name: 'jellyfin' }, values: [[at(40), '1']] },
  ],
  // an OOM kill of redis on the NAS (prometheus label storage-box), two in one step.
  oom: [{ metric: { node: 'storage-box', name: 'redis' }, values: [[at(200), '1.9999']] }],
  containers: [
    { metric: { node: 'pve' }, values: [[at(0), '12']] },
    { metric: { node: 'storage-box' }, values: [[at(0), '4']] },
  ],
  counter: [{ metric: {}, values: [[at(0), '16']] }],
};

/** A Prometheus answering by which expression it is asked. */
function prom(over = {}) {
  const asked = [];
  const answers = { ...SAMPLE, ...over };
  const queryRange = async (query, span) => {
    asked.push({ query, span });
    if (answers.fail) throw answers.fail;
    if (query.startsWith('count by (node)')) return answers.containers;
    if (query.startsWith('count(')) return answers.counter;
    if (query.includes('container_oom_events_total')) return answers.oom;
    if (query.includes('container_start_time_seconds')) return answers.recreated;
    return answers.reset;
  };
  return { asked, queryRange };
}

test('the expressions are the Grafana panel\'s, over the visible nodes, leaving out helpers and CI jobs', () => {
  const q = eventQueries('node=~"pve"', 300);
  assert.match(q.recreated, /^max by \(node, name\) \(\(time\(\) - container_start_time_seconds\{node=~"pve",name!="",/);
  assert.match(q.recreated, /\) < 300\)$/);
  assert.match(q.reset, /container_cpu_usage_seconds_total\{[^}]*\} < bool container_cpu_usage_seconds_total\{[^}]*\} offset 1m\)\[300s:1m\]/);
  assert.match(q.oom, /increase\(container_oom_events_total\{[^}]*\}\[300s\]\)\) > 0$/);
  for (const text of [q.recreated, q.reset, q.oom]) {
    assert.match(text, /container_label_com_getarcaneapp_internal_resource!="true"/);
    assert.match(text, /GITEA-ACTIONS-TASK-/);
  }
});

test('events: a recreation at its creation time, a reset in its step, an OOM kill with its count; one restart is not two', () => {
  const events = eventsOf(SAMPLE, SPAN.step * 1000);
  assert.deepEqual(
    events.map((e) => [e.time / 1000, e.kind, e.node, e.name, e.how ?? e.count]),
    [
      [at(40) - 100, 'restart', 'pve', 'jellyfin', 'container recreated'],
      [at(100), 'restart', 'pve', 'sonarr', 'process restarted'],
      [at(200), 'oom', 'storage-box', 'redis', 2],
    ]
  );
  assert.deepEqual(EVENT_KINDS, ['restart', 'oom']);
});

test('events: junk samples are dropped, never turned into events', () => {
  const events = eventsOf(
    {
      recreated: [{ metric: { node: 'pve' }, values: [[at(1), '5']] }, { metric: { node: 'pve', name: 'a' }, values: [[at(1), 'NaN']] }],
      reset: null,
      oom: [{ metric: { node: 'pve', name: 'b' }, values: [[at(2), '0']] }],
    },
    300_000
  );
  assert.deepEqual(events, []);
});

test('the read: events with the nodes\' services.yaml keys, the visible nodes only, five queries', async () => {
  const { asked, queryRange } = prom();
  const out = await readContainerEvents({ queryRange, config: CONFIG, span: SPAN });
  assert.equal(out.state, 'ok');
  assert.deepEqual([out.startMs, out.endMs, out.stepMs], [SPAN.start * 1000, SPAN.end * 1000, 300_000]);
  assert.deepEqual(out.events.map((e) => `${e.node}/${e.name}`), ['pve/jellyfin', 'pve/sonarr', 'nas/redis']);
  assert.deepEqual([out.blindNodes, out.oomCounter, out.truncated], [[], true, false]);
  assert.equal(asked.length, 5);
  assert.ok(asked.every((a) => /node=~"pve\|storage-box"/.test(a.query) && !/old/.test(a.query)));
  assert.ok(asked.every((a) => a.span.step === 300));
});

test('a node with no container reading is named, and is not a node with no restarts', async () => {
  const { queryRange } = prom({ containers: [{ metric: { node: 'pve' }, values: [[at(0), '12']] }] });
  const out = await readContainerEvents({ queryRange, config: CONFIG, span: SPAN });
  assert.equal(out.state, 'ok');
  assert.deepEqual(out.blindNodes, ['nas']);
});

test('a node that read earlier in the range but not at its end is silent (#838); one that never read is only blind', async () => {
  const every = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => [at(from + i), '12']);
  const last = (SPAN.end - SPAN.start) / SPAN.step;
  // pve reads to the end of the range; storage-box (nas) stopped 20 steps before it; old is not visible.
  const { queryRange } = prom({
    containers: [
      { metric: { node: 'pve' }, values: every(0, last) },
      { metric: { node: 'storage-box' }, values: every(0, last - 20) },
    ],
  });
  const out = await readContainerEvents({ queryRange, config: CONFIG, span: SPAN });
  assert.deepEqual(out.silentNodes, ['nas']);
  assert.deepEqual(out.blindNodes, [], 'it has readings in the range, so it is not blind');
  // Never read: blind, not silent, so a node cAdvisor does not cover cannot page.
  const never = prom({ containers: [{ metric: { node: 'pve' }, values: every(0, last) }] });
  const out2 = await readContainerEvents({ queryRange: never.queryRange, config: CONFIG, span: SPAN });
  assert.deepEqual([out2.blindNodes, out2.silentNodes], [['nas'], []]);
  // Both reading to the end: none.
  const fine = prom({
    containers: [
      { metric: { node: 'pve' }, values: every(0, last) },
      { metric: { node: 'storage-box' }, values: every(0, last) },
    ],
  });
  assert.deepEqual((await readContainerEvents({ queryRange: fine.queryRange, config: CONFIG, span: SPAN })).silentNodes, []);
});

test('no container reading at all (cAdvisor blind) is its own state, with no events', async () => {
  const { queryRange } = prom({ containers: [], recreated: [], reset: [], oom: [], counter: [] });
  const out = await readContainerEvents({ queryRange, config: CONFIG, span: SPAN });
  assert.deepEqual([out.state, out.events, out.blindNodes], ['no-containers', [], []]);
});

test('no OOM counter is said, so a quiet OOM row is not read as "no kills"', async () => {
  const { queryRange } = prom({ counter: [], oom: [] });
  const out = await readContainerEvents({ queryRange, config: CONFIG, span: SPAN });
  assert.equal(out.oomCounter, false);
});

test('no visible node: no container readings and nothing asked', async () => {
  const { asked, queryRange } = prom();
  const out = await readContainerEvents({ queryRange, config: { nodes: {} }, span: SPAN });
  assert.equal(out.state, 'no-containers');
  assert.equal(asked.length, 0);
});

test('a failed query throws, so the chart is failed and not empty', async () => {
  const { queryRange } = prom({ fail: new Error('down') });
  await assert.rejects(readContainerEvents({ queryRange, config: CONFIG, span: SPAN }), /down/);
});

test('a crash-looping container cannot fill the answer: the latest MAX_EVENTS are kept and it says so', async () => {
  const values = Array.from({ length: 289 }, (_, i) => [at(i), '1']);
  const rows = Array.from({ length: 2 }, (_, n) => ({ metric: { node: 'pve', name: `loop${n}` }, values }));
  const { queryRange } = prom({ reset: rows, recreated: [], oom: [] });
  const out = await readContainerEvents({ queryRange, config: CONFIG, span: SPAN });
  assert.equal(out.events.length, MAX_EVENTS);
  assert.equal(out.truncated, true);
  assert.equal(out.events.at(-1).time / 1000, at(288));
});

test('restart loops: containers over the limit in the last hour, most first; OOM kills and old restarts do not count', () => {
  const now = at(288) * 1000;
  const min = (m) => now - m * 60_000;
  const events = [
    ...[5, 15, 25, 35, 45].map((m) => ({ time: min(m), kind: 'restart', node: 'pve', name: 'flappy' })),
    ...[10, 20, 30].map((m) => ({ time: min(m), kind: 'restart', node: 'pve', name: 'meh' })),
    { time: min(61), kind: 'restart', node: 'pve', name: 'meh' },
    { time: min(2), kind: 'oom', node: 'nas', name: 'redis' },
    { time: min(3), kind: 'oom', node: 'nas', name: 'redis' },
    { time: min(40), kind: 'restart', node: 'nas', name: 'flappy' },
  ];
  assert.deepEqual(restartLoops(events, { nowMs: now, limit: 2 }), [
    { node: 'pve', name: 'flappy', restarts: 5 },
    { node: 'pve', name: 'meh', restarts: 3 },
  ]);
  assert.deepEqual(restartLoops(events, { nowMs: now, limit: 4 }).map((r) => r.name), ['flappy']);
  assert.deepEqual(restartLoops(events, { nowMs: now, limit: 5 }), []);
  assert.equal(RESTART_LOOP_WINDOW_MS, 3_600_000);
});

// ── The chart table and the banner mapping ───────────────────────────────

test('restarts: the chart is in the containers section and answers events; a failure is its own sentence', async () => {
  const { MONITORING_CHARTS, createMonitoringCache } = await import('./monitoring.js');
  const chart = MONITORING_CHARTS.restarts;
  assert.deepEqual([chart.section, chart.live], ['containers', undefined]);
  const now = Date.UTC(2026, 9, 29, 12, 0, 30);
  const quiet = { info() {}, warn() {} };
  const ok = createMonitoringCache({ queryRange: prom().queryRange, now: () => now, logger: quiet, charts: { restarts: chart } });
  const [out] = (await ok.answer('24h', CONFIG)).charts;
  assert.deepEqual([out.id, out.ok, out.state, out.events.length, out.stepMs], ['restarts', true, 'ok', 3, 300_000]);

  const bad = createMonitoringCache({
    queryRange: async () => {
      throw Object.assign(new Error('boom'), { status: 400 });
    },
    now: () => now,
    logger: quiet,
    charts: { restarts: chart },
  });
  const [failed] = (await bad.answer('24h', CONFIG)).charts;
  assert.deepEqual([failed.ok, failed.error, failed.events], [false, 'Prometheus refused the container events query (HTTP 400)', undefined]);
});

test('a container restart loop or OOM kill opens the restarts chart; another container issue does not', async () => {
  const { CONTAINER_EVENT_CONDITIONS, FOCUS, chartOfIssue } = await import('./monitoringFocus.js');
  for (const condition of CONTAINER_EVENT_CONDITIONS) {
    assert.equal(chartOfIssue({ kind: 'container', state: 'warn', condition }), FOCUS.restarts, condition);
  }
  assert.equal(chartOfIssue({ kind: 'container', state: 'warn', condition: 'missing' }), null);
  assert.equal(chartOfIssue({ kind: 'container', state: 'warn' }), null);
  assert.equal(chartOfIssue({ kind: 'service', state: 'crit', condition: 'restart_loop' }), null);
});

test('the demo\'s restarts answer is the live shape, its events inside the range, on the demo\'s own nodes', async () => {
  const { demoMonitoring } = await import('./demoFixtures.js');
  for (const range of ['1h', '24h', '7d', '30d']) {
    const { body } = demoMonitoring({ query: { range }, now: Date.UTC(2026, 9, 29, 12) });
    const chart = body.charts.find((c) => c.id === 'restarts');
    assert.equal(chart.ok, true);
    assert.equal(chart.state, 'ok');
    assert.ok(chart.events.length > 0);
    for (const e of chart.events) {
      assert.ok(e.time >= chart.startMs && e.time <= chart.endMs, range);
      assert.ok(EVENT_KINDS.includes(e.kind));
    }
    assert.ok(chart.events.some((e) => e.kind === 'oom') && chart.events.some((e) => e.kind === 'restart'));
  }
});

test('readRecentContainerEvents reads the last hour at the one-minute step the status loop counts from (#764)', async () => {
  const asked = [];
  const now = 1_782_345_600_000;
  const out = await readRecentContainerEvents({
    now,
    config: CONFIG,
    queryRange: async (q, span) => {
      asked.push(span);
      return [];
    },
  });
  assert.equal(out.state, 'no-containers', 'no series at all is not "no restarts"');
  assert.ok(asked.length > 0);
  for (const span of asked) assert.deepEqual(span, { start: now / 1000 - 3600, end: now / 1000, step: 60 });
});
