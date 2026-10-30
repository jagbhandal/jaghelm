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
 * and a reason never show one reading as two numbers. Every comparison of a
 * reading with a line, the model's (rules.js levelOf) and a meter's, is made
 * on one grid, whole hundredths of the reading's unit (toHundredths, atOrOver),
 * so floating-point error never decides a reading exactly on a line.
 *
 * Dependency-free on purpose: the web imports it (src/ui/), as it imports
 * server/icon-sources.js, and the server's runtime image holds server/ but
 * not src/, so a module both sides use lives here.
 */

/** @param {unknown} v */
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The grid every reading and line is compared and shown on (#450): a value in
 * its display unit (a percent, or °C) as whole hundredths of it, rounded once.
 * 91.3 % read as a fraction is 0.9129999999999999 in floating point and the
 * line 0.913 is not, so compared as they are, a reading exactly on that line
 * was under it; on the grid both are 9130.
 *
 * @param {number} value  in its display unit
 * @returns {number}  an integer
 */
export function toHundredths(value) {
  return Math.round(value * 100);
}

/**
 * Whether a reading is at or over a line, on the grid (toHundredths): the one
 * comparison the model's levels (rules.js levelOf, its hysteresis clear and
 * CPU's run) and a meter's state make. `unit` is what one of the arguments'
 * units is in the display unit: 100 for a fraction of 1 (the model's usage
 * readings and lines), 1 for a percent or °C.
 *
 * @param {number} value
 * @param {number} line
 * @param {number} [unit]
 */
export function atOrOver(value, line, unit = 1) {
  return toHundredths(value * unit) >= toHundredths(line * unit);
}

/**
 * A usage line, a fraction of 1 as status/thresholds.js holds it, as a
 * percentage on the grid (0.57 is 57, not 56.99999999999999).
 *
 * @param {number} fraction
 */
export function percentOf(fraction) {
  return toHundredths(fraction * 100) / 100;
}

/**
 * A line in its own unit (percent or °C) as it is written beside a reading:
 * on the grid, to a hundredth (95 − 5 is 90, 87.5 stays 87.5).
 *
 * @param {number} line
 */
export function lineNumber(line) {
  return toHundredths(line) / 100;
}

/** How many decimals a line needs, to a hundredth: 0 (90), 1 (87.5) or 2 (91.25). */
function decimalsOf(/** @type {number} */ line) {
  const hundredths = Math.abs(toHundredths(line));
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
 * finer than a hundredth (a hand-edited 0.87567) are shown, and judged, on the
 * grid of hundredths, so the rule holds there too. Under 0 it shows 0: the
 * model reads usage clamped at 0 (rules.js coerceFraction), and CPU, 100 less
 * the idle rate, can come out at −0.3.
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
  const decimals = Math.max(0, ...all.map(decimalsOf));
  // Rounded down on the grid, in whole steps of the decimals shown: an
  // integer sum, so 0.29 × 100 (28.999999999999996) is 29, as the model judges it.
  const step = 10 ** (2 - decimals);
  return (Math.floor(Math.max(0, toHundredths(value)) / step) * step) / 100;
}

/**
 * The temperature unit a status is drawn in (#494): the one `units` setting
 * ('metric' or 'imperial'), served on /api/status. Only what is DRAWN is
 * converted: readings and lines are stored, judged and compared in °C, so a
 * unit never moves a level. Anything but 'imperial' is °C.
 *
 * @param {unknown} units
 * @returns {'metric' | 'imperial'}
 */
export function temperatureUnits(units) {
  return units === 'imperial' ? 'imperial' : 'metric';
}

/** The symbol the unit draws: "°C" or "°F". @param {unknown} units */
export function temperatureSymbol(units) {
  return temperatureUnits(units) === 'imperial' ? '°F' : '°C';
}

/**
 * A °C value in the unit to draw. Snapped to the °C grid first (a hundredth),
 * the grid it was judged on, so a reading on a line in °C is on it in °F too
 * and monotone after it: 75 °C is 167 °F, never 166.99999999999997.
 *
 * @param {number} celsius
 * @param {unknown} units
 */
export function inTemperatureUnits(celsius, units) {
  if (temperatureUnits(units) === 'metric') return celsius;
  return (toHundredths(celsius) / 100) * 1.8 + 32;
}

/**
 * Lines (warn, crit, and `band`, a difference, not a point) in the unit to
 * draw. The same object for °C.
 *
 * @template {{ warn?: number, crit?: number, band?: number }} L
 * @param {L} lines  in °C, readingLines'
 * @param {unknown} units
 * @returns {L}
 */
export function temperatureLines(lines, units) {
  if (temperatureUnits(units) === 'metric') return lines;
  /** @type {any} */
  const out = { ...lines };
  if (num(out.warn)) out.warn = inTemperatureUnits(out.warn, units);
  if (num(out.crit)) out.crit = inTemperatureUnits(out.crit, units);
  if (num(out.band)) out.band = toHundredths(out.band) / 100 * 1.8;
  return out;
}

/**
 * A °C reading as a meter or a reason prints it: "82 °C" or "179 °F", rounded
 * down by shownReading against its lines in the same unit.
 *
 * @param {number} celsius
 * @param {{ warn?: number, crit?: number, band?: number }} [lines]  in °C
 * @param {unknown} [units]
 */
export function shownTemperature(celsius, lines = {}, units = 'metric') {
  const shown = shownReading(inTemperatureUnits(celsius, units), temperatureLines(lines, units));
  return `${shown} ${temperatureSymbol(units)}`;
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
