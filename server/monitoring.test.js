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
// The tests below the table ask for CPU alone; the power charts have their own file's worth at the end.
const CPU_ONLY = { 'cpu-overview': MONITORING_CHARTS['cpu-overview'] };

/** A cache over a stub Prometheus: `asked` records each query, `failWith` makes the next ones fail. */
function setup(extra = {}) {
  const state = { asked: [], failWith: null, now: NOW };
  const queryRange = async (query, span) => {
    state.asked.push({ query, span });
    if (state.failWith) throw state.failWith;
    return [{ metric: { node: 'pve' }, values: [[span.start, '12.5']] }];
  };
  const cache = createMonitoringCache({ queryRange, now: () => state.now, logger: quiet, charts: CPU_ONLY, ...extra });
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
    ...CPU_ONLY,
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
    charts: CPU_ONLY,
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

// ── Power draw and Monthly cost (#753) ───────────────────────────────────

const POWER = { 'power-draw': MONITORING_CHARTS['power-draw'], 'monthly-cost': MONITORING_CHARTS['monthly-cost'] };

/** A Prometheus answering the watts queries: `rows` are [offset steps, watts]; `peak` adds to the max query. */
function powerSetup({ rows, peak = 5, ups = () => ({ ok: true, runtime: 2460 }), energy } = {}) {
  const asked = [];
  const queryRange = async (query, span) => {
    asked.push({ query, span });
    if (!rows) return [];
    const add = /^max_over_time/.test(query) ? peak : 0;
    return [
      {
        metric: { ups: 'ups1' },
        values: rows.map(([i, w]) => [span.start + i * span.step, String(w + add)]),
      },
    ];
  };
  const cache = createMonitoringCache({
    queryRange,
    now: () => NOW,
    logger: quiet,
    charts: { 'power-draw': POWER['power-draw'] },
    energy,
    ups,
  });
  return { asked, cache };
}

test('power-draw: watts per step of the range, the min, max and mean, and the UPS runtime', async () => {
  const { asked, cache } = powerSetup({ rows: [[0, 88], [1, 92.04], [3, 90]] });
  const [chart] = (await cache.answer('24h', CONFIG)).charts;
  assert.deepEqual([chart.id, chart.section, chart.ok, chart.state, chart.unit], [
    'power-draw',
    'power-cost',
    true,
    'ok',
    'W',
  ]);
  assert.equal(chart.count, 289);
  assert.equal(chart.stepMs, 300_000);
  assert.deepEqual(chart.values.slice(0, 5), [88, 92, null, 90, null], 'a step with no reading is null, never 0');
  assert.equal(chart.values.length, 289);
  assert.deepEqual(chart.stats, { minWatts: 88, maxWatts: 92, avgWatts: 90 });
  assert.equal(chart.maxValues, null, '24 h has no band');
  assert.equal(chart.runtimeMinutes, 41);
  assert.equal(asked.length, 1);
  assert.match(asked[0].query, /nut_load.*nut_real_power_nominal_watts/);
  assert.match(asked[0].query, /\[5m\]/);
});

test('power-draw: 7 d and 30 d also read the highest reading per step, for the band', async () => {
  const { asked, cache } = powerSetup({ rows: [[0, 88], [1, 92]], peak: 6 });
  const [chart] = (await cache.answer('7d', CONFIG)).charts;
  assert.equal(asked.length, 2);
  assert.match(asked[1].query, /^max_over_time\(/);
  assert.deepEqual(chart.maxValues.slice(0, 3), [94, 98, null]);
  assert.equal(chart.stats.maxWatts, 98, 'the highest is the peak, not the highest average');
  assert.equal(chart.stats.minWatts, 88);
});

test('power-draw: no UPS series is a "no-ups" answer with no values, never zeros', async () => {
  const { cache } = powerSetup({ rows: null });
  const [chart] = (await cache.answer('1h', CONFIG)).charts;
  assert.deepEqual([chart.ok, chart.state, chart.values, chart.stats, chart.runtimeMinutes], [true, 'no-ups', [], null, null]);
});

test('power-draw: a failed query is the chart’s own sentence; a missing runtime reading is null', async () => {
  const failing = createMonitoringCache({
    queryRange: async () => {
      throw Object.assign(new Error('bad'), { status: 400 });
    },
    now: () => NOW,
    logger: quiet,
    charts: { 'power-draw': POWER['power-draw'] },
  });
  const [bad] = (await failing.answer('1h', CONFIG)).charts;
  assert.deepEqual([bad.ok, bad.error], [false, 'Prometheus refused the power query (HTTP 400)']);
  const { cache } = powerSetup({ rows: [[0, 90]], ups: () => null });
  assert.equal((await cache.answer('1h', CONFIG)).charts[0].runtimeMinutes, null);
  const down = powerSetup({ rows: [[0, 90]], ups: () => ({ ok: false, runtime: 2460 }) });
  assert.equal((await down.cache.answer('1h', CONFIG)).charts[0].runtimeMinutes, null);
});

/** A cost reader that answers `bundle` and counts its reads. */
function costSetup(bundle) {
  const state = { reads: 0, bundle };
  const energy = {
    async read() {
      state.reads += 1;
      return state.bundle;
    },
  };
  const cache = createMonitoringCache({
    queryRange: async () => [],
    now: () => NOW,
    logger: quiet,
    charts: { 'monthly-cost': POWER['monthly-cost'] },
    energy,
  });
  return { state, cache };
}

const BUNDLE = {
  state: 'ok',
  zone: 'America/New_York',
  currency: '$',
  currentRatePerKwh: 0.16,
  throughMs: NOW,
  days: [
    { day: '2026-10-19', kWh: 2.1, hours: 24, coverage: 1, partial: false, ratePerKwh: 0.14, cost: 0.294 },
    { day: '2026-10-20', kWh: 0.8, hours: 9, coverage: 1, partial: true, ratePerKwh: 0.16, cost: 0.128 },
  ],
  month: {
    month: '2026-10',
    since: null,
    daysInMonth: 31,
    daysLeft: 11.6,
    kWh: 40,
    cost: 6.1,
    gapHours: 0,
    partialToday: true,
    projected: { kWh: 66, cost: 10.2, basisDays: 7, meanDailyKWh: 2.2 },
  },
  stats: {},
};

test('monthly-cost: the finished days with their local-midnight start, the rate in force, and the month', async () => {
  const { cache } = costSetup(BUNDLE);
  const [chart] = (await cache.answer('1h', CONFIG)).charts;
  assert.deepEqual([chart.id, chart.section, chart.ok, chart.state, chart.currency], [
    'monthly-cost',
    'power-cost',
    true,
    'ok',
    '$',
  ]);
  assert.equal(chart.days.length, 2);
  // 2026-10-19 00:00 in New York (EDT, UTC-4).
  assert.equal(chart.days[0].startMs, Date.UTC(2026, 9, 19, 4));
  assert.deepEqual(chart.days[1], {
    day: '2026-10-20',
    startMs: Date.UTC(2026, 9, 20, 4),
    kWh: 0.8,
    cost: 0.128,
    ratePerKwh: 0.16,
    coverage: 1,
    partial: true,
  });
  assert.equal(chart.month.daysLeft, 11.6, 'fractional, as energyCost made it');
  assert.equal(chart.month.projected.cost, 10.2);
  assert.equal('stats' in chart, false, 'no raw bundle leaks through');
});

test('monthly-cost: no rate is kWh and no money; no UPS and a failed read are their own states', async () => {
  const noRate = {
    ...BUNDLE,
    currency: null,
    currentRatePerKwh: null,
    days: BUNDLE.days.map((d) => ({ ...d, ratePerKwh: null, cost: null })),
    month: { ...BUNDLE.month, cost: null, projected: { ...BUNDLE.month.projected, cost: null } },
  };
  const a = costSetup(noRate);
  const [chart] = (await a.cache.answer('1h', CONFIG)).charts;
  assert.deepEqual([chart.ok, chart.currency, chart.currentRatePerKwh, chart.days[0].cost, chart.days[0].kWh], [true, null, null, null, 2.1]);

  const none = costSetup({ state: 'no-ups' });
  assert.deepEqual((await none.cache.answer('1h', CONFIG)).charts[0].state, 'no-ups');

  const failed = costSetup({ state: 'failed', error: 'Prometheus refused the connection' });
  const [bad] = (await failed.cache.answer('1h', CONFIG)).charts;
  assert.deepEqual([bad.ok, bad.error], [false, 'Prometheus refused the connection']);
});

test('monthly-cost is read on every ask (a saved rate shows at once), power-draw once per step', async () => {
  const { state, cache } = costSetup(BUNDLE);
  await cache.answer('30d', CONFIG);
  state.bundle = { ...BUNDLE, currentRatePerKwh: 0.2 };
  const [chart] = (await cache.answer('30d', CONFIG)).charts;
  assert.equal(state.reads, 2);
  assert.equal(chart.currentRatePerKwh, 0.2);
  assert.equal(cache.size(), 0, 'nothing of it is kept here');
});
