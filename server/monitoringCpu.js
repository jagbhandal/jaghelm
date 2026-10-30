/**
 * The CPU chart's read (#756, spec §5 chart 4, "Is a node's CPU off?"): what
 * `cpu-overview` of GET /api/monitoring answers, apart from monitoring.js so
 * the table there stays short.
 *
 * The chart is small multiples, a cell per visible node, so the answer is
 * the node-kind history series' (`lines`, one per node key with a reading,
 * from `base`, monitoring.js' nodeSeries) plus:
 *
 *   nodes        every visible node's key in services.yaml's order, so a node
 *                that is off for the whole range still has its cell (it says
 *                "No data"); `lines` holds only nodes Prometheus answered for
 *   maxLines     (7 d and 30 d) the highest CPU reading in each step, for the
 *                max band behind each cell's line (promHistory's max companion)
 *   thresholds   the lines in force (status/thresholds.js, one table): `cpu`
 *                `{ warn }` and `temp` `{ warn, crit }`, each only where set
 *   iowait,      the drill-down's two charts, each `{ ok: true, unit, lines,
 *   temperature  maxLines? }` or `{ ok: false, error }` with the fixed
 *                sentence of a failed query: one failing leaves the CPU cells
 *                and the other chart as they are
 *
 * A step with no reading is `null` in a line, never 0. The thresholds are
 * kept with the answer for the range's step, as the lines are.
 * A failed CPU or CPU-max query throws, and the cache words it.
 */
import { failureDetail, failureSentence } from './failureWords.js';
import {
  HISTORY_RANGES,
  HISTORY_SERIES,
  linesOf,
  maxQueryOf,
  resolveEntity,
} from './promHistory.js';
import { readingLines } from './status/readings.js';
import { createLogger } from './util/logger.js';

const log = createLogger('monitoring');

/**
 * The lines of one node-kind series over every visible node, and its max
 * companion on 7 d and 30 d; `maxOnly` asks only the companion (the CPU's
 * own lines are already in the base answer).
 */
async function readLines(name, { range, span, queryRange }, target, { maxOnly = false } = {}) {
  const { unit, query } = HISTORY_SERIES[name];
  const { window, max } = HISTORY_RANGES[range];
  const grid = { start: span.start, end: span.end, step: span.step };
  const shape = { ...span, unit, ...target };
  const [matrix, peaks] = await Promise.all([
    maxOnly ? [] : queryRange(query(target.matcher, window), grid),
    max ? queryRange(maxQueryOf(query, target.matcher, window), grid) : null,
  ]);
  return {
    unit,
    lines: maxOnly ? [] : linesOf(matrix, shape),
    ...(max && { maxLines: linesOf(peaks, shape) }),
  };
}

/** A drill-down part: its lines, or the fixed sentence of its failure (and the detail, logged). */
async function readPart(name, request, ctx, target) {
  try {
    return { ok: true, ...(await readLines(name, ctx, target)) };
  } catch (err) {
    log.warn(
      { source: 'prometheus', series: name, range: ctx.range, err: failureDetail(err) },
      'monitoring CPU drill-down failed; it says so until Prometheus answers'
    );
    return { ok: false, error: failureSentence('prometheus', err, { request }) };
  }
}

/** The lines in force as `{ warn, crit }` in the reading's unit, only where set. */
function linesFor(thresholds, reading) {
  const { warn, crit } = readingLines(thresholds, reading);
  return { ...(warn != null && { warn }), ...(crit != null && { crit }) };
}

/**
 * The `cpu-overview` reader: `base` is nodeSeries('node.cpu') (monitoring.js),
 * whose answer is kept as it is and the parts above added to it.
 */
export const readCpuOverview = (base) =>
  async function read(ctx) {
    const answer = await base(ctx);
    const target = resolveEntity({ kind: 'node', entity: null }, ctx.config);
    const thresholds = ctx.thresholds();
    const lines = { cpu: linesFor(thresholds, 'cpu'), temp: linesFor(thresholds, 'temp') };
    const nodes = target.ok ? target.keys : [];
    if (!target.ok || !target.matcher) {
      return {
        ...answer,
        nodes,
        thresholds: lines,
        iowait: { ok: true, unit: '%', lines: [] },
        temperature: { ok: true, unit: '°C', lines: [] },
      };
    }
    const [cpu, iowait, temperature] = await Promise.all([
      HISTORY_RANGES[ctx.range].max ? readLines('node.cpu', ctx, target, { maxOnly: true }) : null,
      readPart('node.iowait', 'I/O wait query', ctx, target),
      readPart('node.temperature', 'temperature query', ctx, target),
    ]);
    return {
      ...answer,
      ...(cpu && { maxLines: cpu.maxLines }),
      nodes,
      thresholds: lines,
      iowait,
      temperature,
    };
  };
