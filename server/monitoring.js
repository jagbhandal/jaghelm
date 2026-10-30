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
 * The ranges, their steps and windows are /api/history's (HISTORY_RANGES), so
 * a line is at most a few hundred points and the two share one clock.
 */
import { getConfig } from './config.js';
import { promQueryRange } from './discovery.js';
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

/**
 * The charts, in page order within a section. `read({ range, span, queryRange,
 * config })` returns the chart's data (`{ unit, startMs, stepMs, count,
 * lines }` for a line chart) or throws.
 */
export const MONITORING_CHARTS = Object.freeze({
  'cpu-overview': Object.freeze({
    title: 'CPU by node',
    question: "Is a node's CPU off?",
    section: 'resources',
    request: 'CPU query',
    read: nodeSeries('node.cpu'),
  }),
});

// A chart that names a section the page doesn't have would never be drawn.
for (const [id, chart] of Object.entries(MONITORING_CHARTS)) {
  if (!SECTION_IDS.includes(chart.section)) throw new Error(`Chart "${id}" names no section`);
}

/**
 * The cache of answered charts (see the header). `queryRange` asks Prometheus
 * (promQueryRange's signature); `now` is the clock, in ms; `charts` the table
 * (tests give their own); `logger` where a failure's detail goes.
 */
export function createMonitoringCache({
  queryRange = promQueryRange,
  now = Date.now,
  charts = MONITORING_CHARTS,
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

    const cached = entries.get(key);
    if (
      cached &&
      cached.end === span.end &&
      (cached.failedAt == null || at - cached.failedAt < FAILURE_TTL_MS)
    ) {
      return Promise.resolve(cached.data);
    }
    const pending = asking.get(key);
    if (pending && pending.end === span.end) return pending.promise;

    const promise = Promise.resolve()
      .then(() => chart.read({ range, span, queryRange, config }))
      .then(
        (payload) => {
          if (failing.delete(id)) {
            logger.info({ source: 'prometheus', chart: id }, 'monitoring chart answers again');
          }
          const data = { ...head, ok: true, ...payload };
          keep(key, { end: span.end, failedAt: null, data });
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
          keep(key, { end: span.end, failedAt: now(), data });
          return data;
        }
      )
      .finally(() => {
        if (asking.get(key)?.promise === promise) asking.delete(key);
      });
    asking.set(key, { end: span.end, promise });
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
