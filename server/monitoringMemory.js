/**
 * The memory chart's read (#757, spec §5 chart 5, "Is memory or swap under
 * strain?"): what `memory` of GET /api/monitoring answers, apart from
 * monitoring.js so the table there stays short.
 *
 * The chart is small multiples, a cell per visible node with two series, memory
 * in use and swap in use, both in percent. The answer is the node-kind history
 * series' (`lines`, one per node key with a memory reading, from `base`,
 * monitoring.js' nodeSeries) plus:
 *
 *   nodes        every visible node's key in services.yaml's order, so a node
 *                that is off for the whole range still has its cell
 *   thresholds   `{ mem: { warn } }`, the line in force (status/thresholds.js)
 *   swap         `{ ok: true, unit, lines }` or `{ ok: false, error }` with the
 *                fixed sentence of a failed query: it failing leaves the memory
 *                lines as they are. `lines` holds only nodes that have swap: a
 *                node with none has no line (never a flat one at 0 %)
 *
 * A step with no reading is `null`, never 0. A failed memory query throws, and
 * the cache words it.
 */
import { failureDetail, failureSentence } from './failureWords.js';
import { HISTORY_RANGES, HISTORY_SERIES, linesOf, resolveEntity } from './promHistory.js';
import { readingLines } from './status/readings.js';
import { createLogger } from './util/logger.js';

const log = createLogger('monitoring');

/** The swap lines of every visible node, or the fixed sentence of the query's failure (its detail logged). */
async function readSwap({ range, span, queryRange }, target) {
  const { unit, query } = HISTORY_SERIES['node.swap'];
  try {
    const matrix = await queryRange(query(target.matcher, HISTORY_RANGES[range].window), {
      start: span.start,
      end: span.end,
      step: span.step,
    });
    return { ok: true, unit, lines: linesOf(matrix, { ...span, unit, ...target }) };
  } catch (err) {
    log.warn(
      { source: 'prometheus', series: 'node.swap', range, err: failureDetail(err) },
      'monitoring swap read failed; it says so until Prometheus answers'
    );
    return { ok: false, error: failureSentence('prometheus', err, { request: 'swap query' }) };
  }
}

/**
 * The `memory` reader: `base` is nodeSeries('node.memory') (monitoring.js),
 * whose answer is kept as it is and the parts above added to it.
 */
export const readMemory = (base) =>
  async function read(ctx) {
    const answer = await base(ctx);
    const target = resolveEntity({ kind: 'node', entity: null }, ctx.config);
    const { warn } = readingLines(ctx.thresholds(), 'mem');
    const thresholds = { mem: warn != null ? { warn } : {} };
    const nodes = target.ok ? target.keys : [];
    if (!target.ok || !target.matcher) {
      return { ...answer, nodes, thresholds, swap: { ok: true, unit: '%', lines: [] } };
    }
    return { ...answer, nodes, thresholds, swap: await readSwap(ctx, target) };
  };
