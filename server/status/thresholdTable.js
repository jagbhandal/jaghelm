// @ts-check
/**
 * The thresholds as Settings → Notifications edits them (#320): the lines of
 * the server's threshold config (thresholds.js) a person sets, in the units a
 * person reads them in, percent and °C, with their checks.
 *
 *   cpu    CPU, a warning line (%), held for thresholds.js' 2 cycles
 *   mem    memory, a warning line (%)
 *   disk   a node's disk and a storage pool, a warning and a critical line (%)
 *   temp   the node's hottest sensor, a warning and a critical line (°C)
 *
 * thresholds.json (thresholdsFile.js) keeps what was saved, a metric each,
 * only the metrics that differ from their defaults: `{ "disk": { "warn": 88,
 * "crit": 94, "unit": "%" } }`. Its unit is written down, so a hand edit can't
 * read 0.9 as 90 %. PUT /api/thresholds (routes/thresholds.js) and the file's
 * reader check a table with the same rules (readThresholdTable), so a hand
 * edit JagHelm wouldn't save is never used either.
 *
 * The hysteresis, CPU's 2 cycles and Kuma's pending cycles are not edited
 * here: they stay the defaults (and `pushThresholds.hysteresis`, a hand edit).
 * Pure: no I/O.
 */

/**
 * @typedef {{ warn: number, crit?: number }} Lines  a metric's lines, in its unit
 * @typedef {{ cpu?: Lines, mem?: Lines, disk?: Lines, temp?: Lines }} SavedLines
 */

/**
 * Each metric: its unit, whether it has a critical line, and the range a line
 * may take. A percentage line from 10 %: the level clears 5 points under it
 * (the hysteresis), so a lower line would never clear. A temperature from
 * 30 °C to 120 °C, which covers every sensor a homelab reads.
 */
export const THRESHOLD_METRICS = Object.freeze({
  cpu: Object.freeze({ unit: '%', crit: false, min: 10, max: 100 }),
  mem: Object.freeze({ unit: '%', crit: false, min: 10, max: 100 }),
  disk: Object.freeze({ unit: '%', crit: true, min: 10, max: 100 }),
  temp: Object.freeze({ unit: '°C', crit: true, min: 30, max: 120 }),
});

export const METRIC_KEYS = Object.freeze(Object.keys(THRESHOLD_METRICS));

const isObject = (/** @type {unknown} */ v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v);
/** A line to a hundredth of its unit, as the model compares and writes lines (readings.js). */
const hundredths = (/** @type {number} */ v) => Math.round(v * 100) / 100;

/** "cpu, mem, disk and temp". */
const KEY_LIST = `${METRIC_KEYS.slice(0, -1).join(', ')} and ${METRIC_KEYS.at(-1)}`;

/**
 * One metric's lines from what was sent or saved, or the error that refuses
 * them. `null` is the default (no lines of its own).
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {{ lines: Lines | null } | { error: string }}
 */
function readMetric(key, value) {
  const spec = THRESHOLD_METRICS[/** @type {keyof typeof THRESHOLD_METRICS} */ (key)];
  if (value === null) return { lines: null };
  const takes = spec.crit ? 'warn, crit and unit' : 'warn and unit';
  if (!isObject(value)) return { error: `${key} must be { ${takes} }, or null for its default` };
  const v = /** @type {Record<string, unknown>} */ (value);
  const extra = Object.keys(v).find((k) => !['warn', 'crit', 'unit'].includes(k));
  if (extra !== undefined) return { error: `${key} takes ${takes} only, not "${extra}"` };
  if (v.unit !== spec.unit) {
    const said = spec.unit === '°C' ? '°C (Celsius)' : spec.unit;
    return { error: `${key}'s unit is ${said}: send "unit": "${spec.unit}"` };
  }
  const range = `from ${spec.min} to ${spec.max} ${spec.unit}`;
  if (!num(v.warn)) return { error: `${key}'s warning line must be a number, ${range}` };
  const warn = hundredths(/** @type {number} */ (v.warn));
  if (warn < spec.min || warn > spec.max) {
    return { error: `${key}'s warning line must be ${range}` };
  }
  if (!spec.crit) {
    if (v.crit !== undefined && v.crit !== null) {
      return { error: `${key} has no critical line: leave crit out` };
    }
    return { lines: { warn } };
  }
  if (!num(v.crit)) return { error: `${key}'s critical line must be a number, ${range}` };
  const crit = hundredths(/** @type {number} */ (v.crit));
  if (crit < spec.min || crit > spec.max) {
    return { error: `${key}'s critical line must be ${range}` };
  }
  if (warn >= crit) {
    return {
      error: `${key}'s warning line (${warn} ${spec.unit}) must be under its critical line (${crit} ${spec.unit})`,
    };
  }
  return { lines: { warn, crit } };
}

/**
 * A table of lines, as PUT /api/thresholds sends it and thresholds.json keeps
 * it: an object with a key per metric, each `{ warn, crit?, unit }` or null
 * (its default). A metric left out is its default too. Returns the lines of
 * each metric that has its own (`lines`), or the first error, with the metric
 * it is about when there is one.
 *
 * @param {unknown} body
 * @returns {{ lines: SavedLines } | { error: string, metric?: string }}
 */
export function readThresholdTable(body) {
  if (!isObject(body)) {
    return { error: `Send the thresholds as a JSON object, a key each for ${KEY_LIST}` };
  }
  const b = /** @type {Record<string, unknown>} */ (body);
  /** @type {Record<string, Lines>} */
  const lines = {};
  for (const key of Object.keys(b)) {
    if (!Object.hasOwn(THRESHOLD_METRICS, key)) {
      return {
        error: `There is no threshold for "${key}": the metrics are ${KEY_LIST}`,
        metric: key,
      };
    }
    const read = readMetric(key, b[key]);
    if ('error' in read) return { error: read.error, metric: key };
    if (read.lines) lines[key] = read.lines;
  }
  return { lines: /** @type {SavedLines} */ (lines) };
}

/** A usage line from a fraction of 1 (thresholds.js) to percent, to a hundredth. */
const percentOf = (/** @type {number} */ f) => Math.round(f * 10000) / 100;

/** A percent line as thresholds.js holds it, a fraction of 1 (87.5 → 0.875, never 0.8749999). */
export const fractionOf = (/** @type {number} */ pct) => Math.round(pct * 100) / 10000;

/**
 * Each metric's lines in its unit, from the thresholds in force
 * (thresholds.js' shape): `{ warn, crit }`, crit null for a metric with none.
 *
 * @param {import('./thresholds.js').Thresholds} t
 * @returns {Record<string, { warn: number, crit: number | null }>}
 */
export function linesInUnits(t) {
  return {
    cpu: { warn: percentOf(t.cpu.warn), crit: null },
    mem: { warn: percentOf(t.mem.warn), crit: null },
    disk: { warn: percentOf(t.disk.warn), crit: percentOf(t.disk.crit) },
    temp: { warn: hundredths(t.temp.warn), crit: hundredths(t.temp.crit) },
  };
}

/**
 * What GET /api/thresholds answers: each metric, in the editor's order, with
 * its unit, the lines in force, its defaults, its range and whether it is set
 * away from its defaults (`custom`).
 *
 * @param {import('./thresholds.js').Thresholds} inForce
 * @param {import('./thresholds.js').Thresholds} defaults
 */
export function thresholdView(inForce, defaults) {
  const now = linesInUnits(inForce);
  const was = linesInUnits(defaults);
  return METRIC_KEYS.map((key) => {
    const spec = THRESHOLD_METRICS[/** @type {keyof typeof THRESHOLD_METRICS} */ (key)];
    const lines = now[key];
    const dflt = was[key];
    return {
      metric: key,
      unit: spec.unit,
      warn: lines.warn,
      crit: lines.crit,
      defaults: dflt,
      min: spec.min,
      max: spec.max,
      custom: lines.warn !== dflt.warn || lines.crit !== dflt.crit,
    };
  });
}

/**
 * What thresholds.json keeps for these lines: only the metrics whose lines
 * differ from the defaults, each with its unit; `{}` when none does.
 *
 * @param {SavedLines} lines
 * @param {import('./thresholds.js').Thresholds} defaults
 * @returns {Record<string, { warn: number, crit?: number, unit: string }>}
 */
export function savedTable(lines, defaults) {
  const was = linesInUnits(defaults);
  /** @type {Record<string, { warn: number, crit?: number, unit: string }>} */
  const out = {};
  for (const key of METRIC_KEYS) {
    const l = /** @type {Lines | undefined} */ (lines[/** @type {keyof SavedLines} */ (key)]);
    if (!l) continue;
    if (l.warn === was[key].warn && (l.crit ?? null) === was[key].crit) continue;
    const spec = THRESHOLD_METRICS[/** @type {keyof typeof THRESHOLD_METRICS} */ (key)];
    out[key] = { warn: l.warn, ...(l.crit !== undefined ? { crit: l.crit } : {}), unit: spec.unit };
  }
  return out;
}
