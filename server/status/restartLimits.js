// @ts-check
/**
 * Per-container restart-loop limits (#798): display-config.json's
 * `restartLimits`, an object of "node:container" keys to a limit, read the way
 * `backupJobs` is (status/backupJobs.js): hand-edited, validated here where it
 * is read, never refused on a save, bad entries dropped with one log line.
 *
 *   { "restartLimits": { "pi-2:vaultwarden": 4 } }
 *
 * The limit is the number of restarts in the last hour a container may have
 * before it is in a restart loop (containerConditions.js): with 4 it alerts at
 * 5 or more. Without an entry a container has RESTART_LOOP_LIMIT (3). pi-2's
 * Vaultwarden standby is stopped and started by design by its sync cron, up to
 * 4 times an hour, so it needs 4.
 *
 * An entry is kept when its key is "node:container" (a node before the first
 * colon, a container after it, no spaces around it) and its value is an
 * integer from RESTART_LOOP_LIMIT to MAX_RESTART_LIMIT. A limit below the
 * default is dropped, not applied: this setting quietens a container that
 * restarts on purpose, and a lower limit would only make the board noisier by
 * a typo. Pure apart from the reader's log line.
 */
import { RESTART_LOOP_LIMIT } from './containerConditions.js';

/** The highest limit accepted: a container allowed more than this per hour is not watched. */
export const MAX_RESTART_LIMIT = 60;
// The same bounds as a cron node and job name (backupJobs.js).
const KEY_MAX = 256 + 1 + 256;
const LOG_ENTRIES = 10;
const LOG_ENTRY_CHARS = 100;

/** @param {unknown} v */
function isContainerKey(v) {
  if (typeof v !== 'string' || v.length > KEY_MAX || v.trim() !== v) return false;
  const colon = v.indexOf(':');
  return colon > 0 && colon < v.length - 1;
}

/**
 * The limits a `restartLimits` value holds, and what it holds that isn't one.
 * No value (undefined or null) is no overrides; a value that isn't an object
 * is dropped whole; in an object, each entry that isn't a valid key with a
 * valid limit is dropped and the others kept.
 *
 * @param {unknown} raw  display-config.json's `restartLimits`
 * @returns {{ limits: Record<string, number>, dropped: unknown[] }}
 */
export function resolveRestartLimits(raw) {
  if (raw === undefined || raw === null) return { limits: {}, dropped: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { limits: {}, dropped: [raw] };
  /** @type {Record<string, number>} */
  const limits = Object.create(null);
  const dropped = [];
  for (const [key, value] of Object.entries(raw)) {
    if (
      isContainerKey(key) &&
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= RESTART_LOOP_LIMIT &&
      value <= MAX_RESTART_LIMIT
    ) {
      limits[key] = value;
    } else dropped.push({ [key]: value });
  }
  return { limits: { ...limits }, dropped };
}

/** @param {unknown} v */
const shown = (v) => String(JSON.stringify(v)).slice(0, LOG_ENTRY_CHARS);

/**
 * Reads the limits from a display config, once a cycle, and logs what it
 * drops once (when the dropped set changes), as createBackupJobsReader does.
 *
 * @param {{ logger: { warn: (fields: object, msg: string) => void } }} deps
 * @returns {(displayConfig: any) => Record<string, number>}
 */
export function createRestartLimitsReader({ logger }) {
  /** @type {string | null} */
  let logged = null;
  return (displayConfig) => {
    const { limits, dropped } = resolveRestartLimits(displayConfig?.restartLimits);
    const now = dropped.length ? JSON.stringify(dropped) : null;
    if (now !== null && now !== logged) {
      logger.warn(
        { count: dropped.length, dropped: dropped.slice(0, LOG_ENTRIES).map(shown) },
        `display-config.json restartLimits: entries dropped; each must be "node:container": an integer from ${RESTART_LOOP_LIMIT} to ${MAX_RESTART_LIMIT}. Those containers keep the default limit`
      );
    }
    logged = now;
    return limits;
  };
}
