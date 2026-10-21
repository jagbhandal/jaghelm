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
 * And the one rule for showing a reading beside them (#450, shownReading):
 * the model's reasons and every meter print a reading through it, so a meter
 * and a reason never show one reading as two numbers.
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

/**
 * A line in its own unit (percent or °C) as it is written beside a reading:
 * to a hundredth, without floating-point noise (95 − 5 is 90, 87.5 stays 87.5).
 *
 * @param {number} line
 */
export function lineNumber(line) {
  return Math.round(line * 100) / 100;
}

/** How many decimals a line needs, to a hundredth: 0 (90), 1 (87.5) or 2 (91.25). */
function decimalsOf(/** @type {number} */ line) {
  const hundredths = Math.round(Math.abs(line) * 100);
  if (hundredths % 100 === 0) return 0;
  return hundredths % 10 === 0 ? 1 : 2;
}

/**
 * A reading as the model's reasons and every meter show it (#450): rounded
 * down, so it never shows a number at or over a line it hasn't crossed (94.6 %
 * by a 95 % line shows 94; 95.0 shows 95). Whole, unless a line it is judged
 * by, or where a level on it clears (the line less `band`), has a fraction:
 * then to that line's decimals, at most two, so a reading over a line never
 * reads as under it either (87.6 % by an 87.5 % line shows 87.6, not 87). Lines
 * finer than a hundredth (a hand-edited 0.87567) are shown to a hundredth, and
 * the rule holds to that.
 *
 * Rounding down, rather than to the nearest, also keeps a reason steady while
 * a reading moves within its whole number, so a steady board's status, and its
 * ETag, hold.
 *
 * @param {number} value  the reading, in its lines' unit (percent or °C)
 * @param {{ warn?: number, crit?: number, band?: number }} [lines]  readingLines', or none
 * @returns {number}
 */
export function shownReading(value, lines = {}) {
  const { warn, crit, band } = lines;
  const at = [warn, crit].filter(num).map((l) => /** @type {number} */ (l));
  const all = num(band) ? [...at, ...at.map((l) => l - /** @type {number} */ (band))] : at;
  const decimals = Math.max(0, ...all.map((l) => decimalsOf(lineNumber(l))));
  const scale = 10 ** decimals;
  // The nudge undoes floating-point error, not a reading: the model reads
  // usage as a fraction, and 0.29 × 100 is 28.999999999999996.
  return Math.floor(value * scale + 1e-9) / scale;
}

// Each reading the model judges (status/rules.js judgeNode), the row of the
// threshold table it reads, whether that row is in fractions of 1, and its
// hysteresis. A storage pool (`pool:<name>`) feeds the disk rule (spec §6.1).
/** @type {Record<string, { row: string, fraction: boolean, band: string }>} */
const ROWS = {
  cpu: { row: 'cpu', fraction: true, band: 'fraction' },
  mem: { row: 'mem', fraction: true, band: 'fraction' },
  disk: { row: 'disk', fraction: true, band: 'fraction' },
  temp: { row: 'temp', fraction: false, band: 'celsius' },
};

/**
 * The lines a node reading is judged by, in its unit: `{ warn, crit, band }`,
 * crit only where the table has one, and `band` how far under its line a
 * level holds (the hysteresis), which shownReading reads. CPU, memory, disk and
 * a storage pool are in percent; the temperature (the hottest sensor) in °C.
 * `{}` for a reading the table has no lines for, or when there is no
 * threshold set (an older server's /api/status).
 *
 * @param {unknown} thresholds  /api/status's `thresholds`, or the set given to the model
 * @param {unknown} reading  a key of a node's `conditions`: cpu, mem, disk, temp or pool:<name>
 * @returns {{ warn?: number, crit?: number, band?: number }}
 */
export function readingLines(thresholds, reading) {
  const key = typeof reading === 'string' && reading.startsWith('pool:') ? 'disk' : reading;
  const at = typeof key === 'string' && Object.hasOwn(ROWS, key) ? ROWS[key] : null;
  if (!at || !thresholds || typeof thresholds !== 'object') return {};
  const row = /** @type {Record<string, unknown>} */ (thresholds)[at.row];
  if (!row || typeof row !== 'object') return {};
  /** @param {unknown} v */
  const inUnit = (v) =>
    at.fraction ? percentOf(/** @type {number} */ (v)) : /** @type {number} */ (v);
  /** @type {{ warn?: number, crit?: number, band?: number }} */
  const lines = {};
  for (const level of /** @type {const} */ (['warn', 'crit'])) {
    const v = /** @type {Record<string, unknown>} */ (row)[level];
    if (num(v)) lines[level] = inUnit(v);
  }
  const h = /** @type {Record<string, unknown>} */ (thresholds).hysteresis;
  const band =
    h && typeof h === 'object' ? /** @type {Record<string, unknown>} */ (h)[at.band] : null;
  if (Object.keys(lines).length > 0 && num(band)) lines.band = inUnit(band);
  return lines;
}
