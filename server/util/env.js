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

/** The address the server listens on when JAGHELM_HOST is unset: every IPv4 interface. */
export const DEFAULT_BIND_HOST = '0.0.0.0';

/**
 * The address to listen on: JAGHELM_HOST, trimmed, or {@link DEFAULT_BIND_HOST}
 * when it is unset or blank. Not validated here: a wrong address makes listen()
 * fail, and the server exits saying so (server/index.js).
 */
export function resolveBindHost(env = process.env) {
  return (env.JAGHELM_HOST || '').trim() || DEFAULT_BIND_HOST;
}
