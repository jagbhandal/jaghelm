/**
 * Parse an env-var override as a finite, POSITIVE number (ms, count, etc.).
 *
 * A typo'd / `Infinity` / negative / `NaN` value falls back to `def` rather than
 * silently taking effect — e.g. a bad `*_TTL_MS` must not disable prune (which
 * would let a registry grow unbounded), and a bad staleness window must not
 * silently change outage detection.
 */
export function positiveMs(envVal, def) {
  const n = Number(envVal);
  return Number.isFinite(n) && n > 0 ? n : def;
}
