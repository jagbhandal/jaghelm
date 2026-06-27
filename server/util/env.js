/**
 * Parse an env-var override as a finite, POSITIVE number (ms, seconds, count, etc.).
 *
 * A typo'd / `Infinity` / negative / `NaN` value falls back to `def` rather than
 * silently taking effect — e.g. a bad `*_TTL_MS` must not disable prune (which
 * would let a registry grow unbounded), and a bad staleness window must not
 * silently change outage detection.
 */
export function positiveNum(envVal, def) {
  const n = Number(envVal);
  return Number.isFinite(n) && n > 0 ? n : def;
}

/** Unit-named alias of {@link positiveNum} for the existing millisecond callers. */
export const positiveMs = positiveNum;
