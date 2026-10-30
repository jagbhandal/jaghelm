/**
 * The Monitoring page's chart table and cache (#751, monitoring.js): what each
 * chart asks Prometheus, the cache that keeps every reader within one step on
 * one read, and a failure that is one chart's own, in its fixed sentence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FAILURE_TTL_MS,
  MONITORING_CHARTS,
  MONITORING_RANGES,
  createMonitoringCache,
  parseMonitoringRange,
} from './monitoring.js';
import { MONITORING_SECTIONS } from './monitoringSections.js';

const CONFIG = { nodes: { pve: {}, nas: { prometheus_node: 'storage-box' }, old: { visible: false } } };
// 2026-10-20 09:00:30 UTC: half a minute past a 1h step.
const NOW = Date.UTC(2026, 9, 20, 9, 0, 30);
const quiet = { info() {}, warn() {} };

/** A cache over a stub Prometheus: `asked` records each query, `failWith` makes the next ones fail. */
function setup(extra = {}) {
  const state = { asked: [], failWith: null, now: NOW };
  const queryRange = async (query, span) => {
    state.asked.push({ query, span });
    if (state.failWith) throw state.failWith;
    return [{ metric: { node: 'pve' }, values: [[span.start, '12.5']] }];
  };
  const cache = createMonitoringCache({ queryRange, now: () => state.now, logger: quiet, ...extra });
  return { state, cache };
}

test('every chart in the table names a section the page has, and a question', () => {
  const sections = new Set(MONITORING_SECTIONS.map((s) => s.id));
  assert.ok(Object.keys(MONITORING_CHARTS).length >= 1);
  for (const [id, chart] of Object.entries(MONITORING_CHARTS)) {
    assert.ok(sections.has(chart.section), id);
    assert.equal(typeof chart.title, 'string', id);
    assert.equal(typeof chart.question, 'string', id);
    assert.equal(typeof chart.read, 'function', id);
    assert.equal(typeof chart.request, 'string', id);
  }
  assert.throws(() => {
    MONITORING_CHARTS['cpu-overview'].title = 'x';
  }, TypeError);
});

test('the ranges are /api/history\'s, and a request names one of them', () => {
  assert.deepEqual(MONITORING_RANGES, ['1h', '24h', '7d', '30d']);
  assert.equal(parseMonitoringRange({ range: '30d' }), '30d');
  for (const query of [{}, { range: '2h' }, { range: ['1h'] }, { range: 'constructor' }]) {
    assert.equal(parseMonitoringRange(query), null, JSON.stringify(query));
  }
});

test("cpu-overview asks for every visible node's CPU and answers a line per node key", async () => {
  const { state, cache } = setup();
  const out = await cache.answer('1h', CONFIG);
  assert.equal(out.range, '1h');
  const [cpu] = out.charts;
  assert.deepEqual(
    [cpu.id, cpu.section, cpu.ok, cpu.unit, cpu.stepMs, cpu.count],
    ['cpu-overview', 'resources', true, '%', 60_000, 61]
  );
  assert.equal(state.asked.length, 1);
  assert.match(state.asked[0].query, /node=~"pve\|storage-box"/);
  assert.doesNotMatch(state.asked[0].query, /old/);
  assert.deepEqual(cpu.lines.map((l) => [l.entity, l.values[0]]), [['pve', 12.5]]);
});

test('no visible node: an answered chart with no lines, and nothing asked', async () => {
  const { state, cache } = setup();
  const out = await cache.answer('1h', { nodes: {} });
  assert.deepEqual([out.charts[0].ok, out.charts[0].lines], [true, []]);
  assert.equal(state.asked.length, 0);
});

test('concurrent readers share one read; a later one in the same step reads nothing', async () => {
  const { state, cache } = setup();
  const [a, b] = await Promise.all([cache.answer('24h', CONFIG), cache.answer('24h', CONFIG)]);
  assert.deepEqual(a, b);
  assert.equal(state.asked.length, 1);
  state.now += 60_000;
  await cache.answer('24h', CONFIG);
  assert.equal(state.asked.length, 1, 'still within the 5-minute step');
  await cache.answer('7d', CONFIG);
  assert.equal(state.asked.length, 2, 'another range is another entry');
  assert.equal(cache.size(), 2);
});

test("an answer is read again once the range's next step begins", async () => {
  const { state, cache } = setup();
  await cache.answer('1h', CONFIG);
  state.now += 60_000; // into the next minute
  await cache.answer('1h', CONFIG);
  assert.equal(state.asked.length, 2);
});

test("a failure is one chart's own sentence, kept briefly, never Prometheus's text", async () => {
  let reads = 0;
  const charts = {
    ...MONITORING_CHARTS,
    'always-fails': Object.freeze({
      title: 'Broken',
      question: 'q',
      section: 'drives',
      request: 'broken query',
      read: async () => {
        reads += 1;
        throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:9090'), { code: 'ECONNREFUSED' });
      },
    }),
  };
  const { state, cache } = setup({ charts });
  const out = await cache.answer('1h', CONFIG);
  const [good, bad] = out.charts;
  assert.equal(good.ok, true, 'the other chart is not dragged down');
  assert.deepEqual(
    [bad.id, bad.ok, bad.error, bad.lines],
    ['always-fails', false, 'Prometheus refused the connection', undefined]
  );
  assert.doesNotMatch(JSON.stringify(out), /10\.0\.0\.9|ECONNREFUSED/);

  // The sentence names the chart's read for a refused query.
  const refused = createMonitoringCache({
    queryRange: async () => {
      throw Object.assign(new Error('bad'), { status: 400 });
    },
    now: () => NOW,
    logger: quiet,
  });
  assert.equal((await refused.answer('1h', CONFIG)).charts[0].error, 'Prometheus refused the CPU query (HTTP 400)');

  // Kept for FAILURE_TTL_MS: no second ask inside it, and a new ask after it.
  assert.equal(reads, 1);
  await cache.answer('1h', CONFIG);
  assert.equal(reads, 1, 'kept');
  state.now += FAILURE_TTL_MS + 1;
  await cache.answer('1h', CONFIG);
  assert.equal(reads, 2, 'asked again after the failure expired');
  assert.equal(state.asked.length, 1, 'the good chart was not re-read');
});

test('a failing chart logs once when it starts and once when it answers again', async () => {
  const lines = [];
  const logger = { info: (_, m) => lines.push(['info', m]), warn: (_, m) => lines.push(['warn', m]) };
  const { state, cache } = setup({ logger });
  state.failWith = new Error('down');
  await cache.answer('1h', CONFIG);
  state.now += FAILURE_TTL_MS + 1;
  await cache.answer('1h', CONFIG);
  assert.deepEqual(lines.map((l) => l[0]), ['warn'], 'the same cause is not logged twice');
  state.failWith = null;
  state.now += FAILURE_TTL_MS + 1;
  await cache.answer('1h', CONFIG);
  assert.deepEqual(lines.map((l) => l[0]), ['warn', 'info']);
});
