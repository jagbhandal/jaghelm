/**
 * The Monitoring page's charts (#751, spec §7): what GET /api/monitoring
 * serves, one read for every chart on the page.
 *
 * The charts are defined here, in one frozen table like HISTORY_SERIES
 * (promHistory.js): each chart has an id, a title, the question it answers,
 * its section (monitoringSections.js), `request` (what a refused read of it
 * is called in its failure sentence: "Prometheus refused the CPU query (HTTP
 * 400)") and `read`, the function that asks Prometheus and returns the
 * chart's data or throws. The client sends a range and nothing else, never
 * PromQL; a chart that is not in the table cannot be asked for. A later card
 * adds a chart by adding its row (and its drawing in the client).
 *
 * Caching follows promHistory.js: each (chart, range) is kept until its
 * range's next step begins, so any number of open pages cost one read of each
 * chart per step; a read that is being asked is shared by whoever asks again.
 * A failed read is kept for FAILURE_TTL_MS, so a Prometheus that doesn't
 * answer isn't asked again by every poll. A chart's failure goes out as that
 * chart's own fixed sentence (failureWords.js, #605), never Prometheus's text:
 * the raw detail is logged here, once when a chart's failure starts or
 * changes and once when it answers again. One chart failing leaves the others
 * as they are, and a failed chart never draws an empty line that looks
 * healthy.
 *
 * A chart may be `live`: not kept, because its reader keeps its own and is
 * cheap (the cost: a saved rate must show at once, not at the range's next
 * step). A reader may also answer `{ ok: false, error }` with a sentence it
 * already has (the cost's own failed state), which goes out as it is.
 *
 * The ranges, their steps and windows are /api/history's (HISTORY_RANGES), so
 * a line is at most a few hundred points and the two share one clock.
 */
import { getCached } from './cache.js';
import { getConfig } from './config.js';
import { promQueryRange } from './discovery.js';
import { dayStartMs, energyCost, maxWattsQuery, samplesOf, wattsQuery } from './energyCost.js';
import { envValue } from './env.js';
import { failureDetail, failureSentence } from './failureWords.js';
import { HISTORY_RANGES, HISTORY_SERIES, linesOf, rangeWindow, resolveEntity } from './promHistory.js';
import { SECTION_IDS } from './monitoringSections.js';
import { createLogger } from './util/logger.js';

const log = createLogger('monitoring');

/** How long a failed read is kept before Prometheus is asked again. */
export const FAILURE_TTL_MS = 10_000;
/** Distinct (chart, range) entries kept; the oldest written goes first. */
const MAX_ENTRIES = 100;

/** The ranges the page can ask for. */
export const MONITORING_RANGES = Object.freeze(Object.keys(HISTORY_RANGES));

/**
 * A chart that is one node-kind history series, every visible node at once
 * (the Overview's node cards ask the same): its lines are the nodes, by key.
 * Reads through `queryRange` so a failure throws and the cache words it.
 */
const nodeSeries = (name) =>
  async function read({ range, span, queryRange, config }) {
    const { unit, query } = HISTORY_SERIES[name];
    const { window } = HISTORY_RANGES[range];
    const head = { unit, startMs: span.start * 1000, stepMs: span.step * 1000, count: span.count };
    const target = resolveEntity({ kind: 'node', entity: null }, config);
    if (!target.ok || !target.matcher) return { ...head, lines: [] };
    const matrix = await queryRange(query(target.matcher, window), {
      start: span.start,
      end: span.end,
      step: span.step,
    });
    return { ...head, lines: linesOf(matrix, { ...span, unit, ...target }) };
  };

const NET_GAPS = (count) => new Array(count).fill(null);

/**
 * Traffic per node (#758, spec §5 chart 9): bytes per second in and out of
 * each visible node, its real interfaces summed (HISTORY_SERIES' node.net.rx
 * and node.net.tx, VIRTUAL_INTERFACES left out). Answers `{ unit, startMs,
 * stepMs, count, nodes }`, `nodes` being `{ entity, rx, tx }` in services.yaml's
 * order, `rx` and `tx` one reading per step; a step with no reading is `null`
 * (a gap, never 0), and a node with neither series has no entry. A failed
 * query throws, and the cache words it.
 */
async function readNetwork({ range, span, queryRange, config }) {
  const { window } = HISTORY_RANGES[range];
  const unit = HISTORY_SERIES['node.net.rx'].unit;
  const head = { unit, startMs: span.start * 1000, stepMs: span.step * 1000, count: span.count };
  const target = resolveEntity({ kind: 'node', entity: null }, config);
  if (!target.ok || !target.matcher) return { ...head, nodes: [] };
  const grid = { start: span.start, end: span.end, step: span.step };
  const [rx, tx] = await Promise.all(
    ['node.net.rx', 'node.net.tx'].map(async (name) =>
      linesOf(await queryRange(HISTORY_SERIES[name].query(target.matcher, window), grid), {
        ...span,
        unit,
        ...target,
      })
    )
  );
  const valuesOf = (lines, entity) => lines.find((l) => l.entity === entity)?.values ?? NET_GAPS(span.count);
  const nodes = target.keys
    .filter((entity) => [rx, tx].some((lines) => lines.some((l) => l.entity === entity)))
    .map((entity) => ({ entity, rx: valuesOf(rx, entity), tx: valuesOf(tx, entity) }));
  return { ...head, nodes };
}

const round1 = (n) => Math.round(n * 10) / 10;

/** The UPS name the install set (JAGHELM_UPS_NAME), else null: any UPS. */
const upsNameOf = () => envValue('JAGHELM_UPS_NAME').trim() || null;

/**
 * The lab's draw in watts (#753, spec §5 chart 1): the UPS's load fraction
 * times its nominal watts, the average over each step of the range (the
 * hourly query of the cost, at the range's own window), so it is the same
 * number the cost is made of. Not metered: what is plugged into the UPS.
 *
 * Answers `{ unit, startMs, stepMs, count, state, values, maxValues, stats,
 * runtimeMinutes }`. `state` is 'ok', or 'no-ups' when Prometheus has no UPS
 * series at all (none set up, or the exporter quiet for the whole range): then
 * there are no values, and the client says so in words, never a line at 0 W. A
 * step with no reading is `null`, which breaks the line. `maxValues` (7 d and
 * 30 d) is the highest reading in each step, for the max band; `stats` the
 * lowest average, highest peak and mean of the drawn values. `runtimeMinutes` (1 h and 24 h only, absent on 7 d and 30 d) is the UPS's
 * remaining runtime at the present load (the UPS panel's reading), null
 * without one. A failed query throws, and the cache words it.
 */
async function readPowerDraw({ range, span, queryRange, ups }) {
  const { window, max } = HISTORY_RANGES[range];
  const name = upsNameOf();
  const grid = { start: span.start, end: span.end, step: span.step };
  const head = {
    unit: 'W',
    startMs: span.start * 1000,
    stepMs: span.step * 1000,
    count: span.count,
  };
  const matrix = await queryRange(wattsQuery(name, window), grid);
  const samples = samplesOf(matrix, span.start, span.end, span.step);
  if (samples === null) {
    return { ...head, state: 'no-ups', values: [], maxValues: null, stats: null, runtimeMinutes: null };
  }
  const values = samples.map((s) => (s.watts === null ? null : round1(s.watts)));
  let maxValues = null;
  if (max) {
    // The band is the same UPS's peaks; a failed second query is the chart's failure.
    const peaks = samplesOf(await queryRange(maxWattsQuery(name, window), grid), span.start, span.end, span.step);
    maxValues = (peaks ?? samples).map((s, i) =>
      s.watts === null ? null : Math.max(round1(s.watts), values[i] ?? 0)
    );
  }
  const drawn = values.filter((v) => v !== null);
  const stats = drawn.length
    ? {
        minWatts: Math.min(...drawn),
        maxWatts: Math.max(...(maxValues?.filter((v) => v !== null) ?? drawn)),
        avgWatts: round1(drawn.reduce((a, b) => a + b, 0) / drawn.length),
      }
    : null;
  const answer = { ...head, state: 'ok', values, maxValues, stats };
  // The runtime is "at the current load": an answer kept for a 30 min or 2 h step
  // would say it of a load long gone, so only the 1 h and 24 h answers carry it.
  if (!['1h', '24h'].includes(range)) return answer;
  const reading = ups();
  const seconds = reading?.ok === false ? null : reading?.runtime;
  const runtimeMinutes = Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds / 60) : null;
  return { ...answer, runtimeMinutes };
}

/**
 * What the lab costs per day (#753, spec §5 chart 2 and §6): energyCost's
 * finished bundle, trimmed to what the page draws. Always the last 30 days
 * by local day whatever the page's range is (a day is the unit), and `live`:
 * energyCost keeps the Prometheus answer for the hour and applies the rates
 * on every read, so a saved rate shows on the next read.
 *
 * `state` is 'ok', 'no-ups' (no UPS series: no days, no tiles), or the
 * failed state `{ ok: false, error }`. In 'ok': `currency` and
 * `currentRatePerKwh` are null with no rate set (then the days carry kWh and
 * no money, and the client says how to set a rate); `days` are `{ day,
 * kWh, cost, ratePerKwh, coverage, partial }`, oldest first (money for a day
 * is rounded on its own, so bars need not sum to the month figure; the
 * client sums nothing); `month` is `{ month, since, daysLeft, kWh, cost,
 * projected }` as energyCost made it (`daysLeft` is fractional).
 */
async function readMonthlyCost({ energy }) {
  const got = await energy.read();
  if (got.state === 'failed') return { ok: false, error: got.error };
  if (got.state === 'no-ups') return { state: 'no-ups' };
  const { month } = got;
  return {
    state: 'ok',
    zone: got.zone,
    currency: got.currency,
    currentRatePerKwh: got.currentRatePerKwh,
    throughMs: got.throughMs,
    days: got.days.map((d) => ({
      day: d.day,
      startMs: dayStartMs(d.day, got.zone),
      kWh: d.kWh,
      cost: d.cost,
      ratePerKwh: d.ratePerKwh,
      coverage: d.coverage,
      partial: d.partial,
    })),
    month: {
      month: month.month,
      since: month.since,
      daysLeft: month.daysLeft,
      kWh: month.kWh,
      cost: month.cost,
      projected: month.projected,
    },
  };
}

/**
 * The charts, in page order within a section. `read({ range, span, queryRange,
 * config, energy, ups })` returns the chart's data (`{ unit, startMs, stepMs,
 * count, lines }` for a line chart) or throws; `energy` is energyCost's reader
 * and `ups()` the UPS panel's last reading (null without one).
 */
export const MONITORING_CHARTS = Object.freeze({
  'cpu-overview': Object.freeze({
    title: 'CPU by node',
    question: "Is a node's CPU off?",
    section: 'resources',
    request: 'CPU query',
    read: nodeSeries('node.cpu'),
  }),
  'power-draw': Object.freeze({
    title: 'Power draw',
    question: 'What does the lab draw?',
    section: 'power-cost',
    request: 'power query',
    read: readPowerDraw,
  }),
  'monthly-cost': Object.freeze({
    title: 'Monthly cost',
    question: 'What does it cost?',
    section: 'power-cost',
    request: 'power query',
    live: true,
    read: readMonthlyCost,
  }),
  network: Object.freeze({
    title: 'Network',
    question: 'Is traffic normal?',
    section: 'resources',
    request: 'network query',
    read: readNetwork,
  }),
});

// A chart that names a section the page doesn't have would never be drawn.
for (const [id, chart] of Object.entries(MONITORING_CHARTS)) {
  if (!SECTION_IDS.includes(chart.section)) throw new Error(`Chart "${id}" names no section`);
}

/**
 * The cache of answered charts (see the header). `queryRange` asks Prometheus
 * (promQueryRange's signature); `now` is the clock, in ms; `charts` the table
 * (tests give their own); `energy` the cost reader (energyCost) and `ups` the
 * UPS panel's last reading; `logger` where a failure's detail goes.
 */
export function createMonitoringCache({
  queryRange = promQueryRange,
  now = Date.now,
  charts = MONITORING_CHARTS,
  energy = energyCost,
  ups = () => getCached('ups'),
  logger = log,
} = {}) {
  const entries = new Map(); // key -> { end, failedAt, data }
  const asking = new Map(); // key -> { end, promise }
  // The failure being logged, per chart (its words), so an outage logs once.
  const failing = new Map();

  const keep = (key, entry) => {
    entries.delete(key);
    if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
    entries.set(key, entry);
  };

  /** One chart's answer for the range, from the cache or Prometheus. */
  function read(id, range, config) {
    const chart = charts[id];
    const at = now();
    const span = rangeWindow(range, at);
    const head = { id, title: chart.title, question: chart.question, section: chart.section };
    const key = `${id}|${range}`;

    const cached = chart.live ? undefined : entries.get(key);
    if (
      cached &&
      cached.end === span.end &&
      (cached.failedAt == null || at - cached.failedAt < FAILURE_TTL_MS)
    ) {
      return Promise.resolve(cached.data);
    }
    const pending = chart.live ? undefined : asking.get(key);
    if (pending && pending.end === span.end) return pending.promise;

    const promise = Promise.resolve()
      .then(() => chart.read({ range, span, queryRange, config, energy, ups }))
      .then(
        (payload) => {
          // A reader's own failed answer (the cost's): its sentence goes out as it is.
          if (payload?.ok === false) {
            const data = { ...head, ok: false, error: payload.error };
            if (!chart.live) keep(key, { end: span.end, failedAt: now(), data });
            return data;
          }
          if (failing.delete(id)) {
            logger.info({ source: 'prometheus', chart: id }, 'monitoring chart answers again');
          }
          const data = { ...head, ok: true, ...payload };
          if (!chart.live) keep(key, { end: span.end, failedAt: null, data });
          return data;
        },
        (err) => {
          const error = failureSentence('prometheus', err, { request: chart.request });
          if (failing.get(id) !== error) {
            failing.set(id, error);
            logger.warn(
              { source: 'prometheus', chart: id, range, err: failureDetail(err) },
              'monitoring chart failed; it says so until Prometheus answers'
            );
          }
          const data = { ...head, ok: false, error };
          if (!chart.live) keep(key, { end: span.end, failedAt: now(), data });
          return data;
        }
      )
      .finally(() => {
        if (asking.get(key)?.promise === promise) asking.delete(key);
      });
    if (!chart.live) asking.set(key, { end: span.end, promise });
    return promise;
  }

  return {
    /**
     * The answer to a range: `{ range, charts }`, each chart answered or
     * failed with its own sentence, in table order.
     */
    async answer(range, config = getConfig()) {
      const list = await Promise.all(Object.keys(charts).map((id) => read(id, range, config)));
      return { range, charts: list };
    },
    /** How many answers are kept. */
    size() {
      return entries.size;
    },
    /** Test seam: forget every answer. */
    clear() {
      entries.clear();
      asking.clear();
      failing.clear();
    },
  };
}

/** The server's one cache, which the route reads through. */
export const monitoringCache = createMonitoringCache();

/** A request's range: the range itself, or null for a missing or unknown one. */
export function parseMonitoringRange(query = {}) {
  const { range } = query;
  return typeof range === 'string' && MONITORING_RANGES.includes(range) ? range : null;
}
