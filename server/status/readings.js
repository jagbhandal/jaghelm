// @ts-check
/**
 * What the screens draw beside a node reading (#451; spec §8: a meter colours
 * only above its line): the lines the status model judged it by, in the
 * reading's own unit. They are read from a threshold set in
 * status/thresholds.js's shape, which /api/status serves as `thresholds` (the
 * set the model used that cycle), so a meter's threshold tick and its
 * "warning above 90%" are the model's lines, and no client keeps a copy of
 * them.
 *
 * Dependency-free on purpose: the web imports it (src/ui/), as it imports
 * server/icon-sources.js, and the server's runtime image holds server/ but
 * not src/, so a module both sides use lives here.
 */

/** @param {unknown} v */
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * A usage line, a fraction of 1 as status/thresholds.js holds it, as a
 * percentage to a hundredth, without floating-point noise (0.57 is 57, not
 * 56.99999999999999).
 *
 * @param {number} fraction
 */
export function percentOf(fraction) {
  return Math.round(fraction * 10000) / 100;
}

// Each reading the model judges (status/rules.js judgeNode), the row of the
// threshold table it reads, and whether that row is in fractions of 1. A
// storage pool (`pool:<name>`) feeds the disk rule (spec §6.1).
/** @type {Record<string, { row: string, fraction: boolean }>} */
const ROWS = {
  cpu: { row: 'cpu', fraction: true },
  mem: { row: 'mem', fraction: true },
  disk: { row: 'disk', fraction: true },
  temp: { row: 'temp', fraction: false },
};

/**
 * The lines a node reading is judged by, in its unit: `{ warn, crit }`, crit
 * only where the table has one. CPU, memory, disk and a storage pool are in
 * percent; the temperature (the hottest sensor) in °C. `{}` for a reading the
 * table has no lines for, or when there is no threshold set (an older server's
 * /api/status).
 *
 * @param {unknown} thresholds  /api/status's `thresholds`, or the set given to the model
 * @param {unknown} reading  a key of a node's `conditions`: cpu, mem, disk, temp or pool:<name>
 * @returns {{ warn?: number, crit?: number }}
 */
export function readingLines(thresholds, reading) {
  const key = typeof reading === 'string' && reading.startsWith('pool:') ? 'disk' : reading;
  const at = typeof key === 'string' && Object.hasOwn(ROWS, key) ? ROWS[key] : null;
  if (!at || !thresholds || typeof thresholds !== 'object') return {};
  const row = /** @type {Record<string, unknown>} */ (thresholds)[at.row];
  if (!row || typeof row !== 'object') return {};
  /** @type {{ warn?: number, crit?: number }} */
  const lines = {};
  for (const level of /** @type {const} */ (['warn', 'crit'])) {
    const v = /** @type {Record<string, unknown>} */ (row)[level];
    if (num(v))
      lines[level] = at.fraction ? percentOf(/** @type {number} */ (v)) : /** @type {number} */ (v);
  }
  return lines;
}
