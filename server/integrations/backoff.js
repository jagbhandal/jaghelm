/**
 * Per-integration retry state for the refresh loop (#239).
 *
 * Every integration used to be fetched every cycle however long it had been
 * failing, each dead one holding one of the fetch slots for up to the 8 s
 * timeout, and a rejected login was sent again every cycle, forever (an app that
 * bans an address after failed logins would ban JagHelm's).
 *
 * Now each integration is in one of three states:
 *
 * - `ok`: its last attempt succeeded. It is fetched every cycle.
 * - `backing_off`: its last attempts failed. The next one waits 30 s after the
 *   first failure, then 1, 2, 4 and 8 min, then every 10 min, and a success
 *   resets that.
 * - `auth_failed`: its last attempt was a rejected login (`authRejected` from
 *   fetchIntegration: a 401 or 403 to the session login, or to a request that
 *   carried its credentials). It is not attempted again until its config
 *   changes.
 *
 * "Its config" is the fingerprint the caller passes (configFingerprint in
 * lib/config.js): its entry in services.yaml with its credentials resolved, so
 * a hand edit (the config watcher), a save in Settings and a new stored secret
 * each count. An attempt whose fingerprint differs from the last one's starts
 * from a clean slate, and so does one after retryNow (the Settings save calls
 * it, so saving unchanged is the way to say "try again now"). The state is in
 * memory: a restart attempts every integration again.
 *
 * While an integration is not due, the caller serves the entry its last attempt
 * left (held), as the failure was served when it happened: its `_error` and
 * nothing fetched, so the dashboard shows it as it does a failed fetch. Every
 * entry carries `_status: { state, since, failures, nextAttemptAt }`: `since`
 * is when the state began (ms epoch), `failures` the failed attempts in a row
 * under this config, and `nextAttemptAt` when it will be attempted again (ms
 * epoch; null when ok, as it is attempted every cycle, or auth failed, as it
 * waits for a config change). None of them change between attempts, so the
 * payload's ETag holds.
 */

export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 10 * 60_000;
// A cycle is timed by an interval timer and the attempt times by the cycle's
// start, so a cycle can start a moment before an attempt is due: it still
// makes the attempt rather than waiting a whole extra interval.
const DUE_SLACK_MS = 1_000;

/** The wait after `failures` failed attempts in a row: 30 s doubling, at most 10 min. */
export function backoffDelayMs(failures) {
  if (failures < 1) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
}

/**
 * @param {{ logger?: { warn: Function, info: Function } }} [opts]
 */
export function createIntegrationBackoff({ logger } = {}) {
  // key -> { fingerprint, state, since, failures, nextAttemptAt, entry, retry? }
  const byKey = new Map();

  return {
    /**
     * The entry to serve for `key` this cycle without fetching it, or null when
     * it is to be attempted: it is new, ok, due, or its config changed.
     */
    held(key, fingerprint, now) {
      const s = byKey.get(key);
      if (!s || s.state === 'ok' || s.retry || s.fingerprint !== fingerprint) return null;
      if (s.state === 'backing_off' && now >= s.nextAttemptAt - DUE_SLACK_MS) return null;
      return s.entry;
    },

    /**
     * Record an attempt made at `now` (the cycle's start) and return its entry
     * with `_status`. It failed when the entry has an `_error`. The entry is
     * kept to be served again until the next attempt, so it must not be
     * mutated afterwards.
     */
    record(key, fingerprint, entry, { authRejected = false } = {}, now) {
      const prev = byKey.get(key);
      // The same config's earlier failures count; a changed config, or a
      // retryNow, starts over.
      const carried = prev && !prev.retry && prev.fingerprint === fingerprint ? prev : null;
      let next;
      if (!entry._error) {
        if (prev && prev.state !== 'ok')
          logger?.info({ key, failures: prev.failures }, 'integration recovered');
        next = {
          state: 'ok',
          since: prev?.state === 'ok' ? prev.since : now,
          failures: 0,
          nextAttemptAt: null,
        };
      } else {
        const failures = (carried?.failures || 0) + 1;
        if (authRejected) {
          logger?.warn(
            { key, error: entry._error },
            'integration login rejected; not retrying until its config changes'
          );
          next = { state: 'auth_failed', since: now, failures, nextAttemptAt: null };
        } else {
          const since = carried?.state === 'backing_off' ? carried.since : now;
          next = {
            state: 'backing_off',
            since,
            failures,
            nextAttemptAt: now + backoffDelayMs(failures),
          };
        }
      }
      const served = { ...entry, _status: { ...next } };
      byKey.set(key, { fingerprint, ...next, entry: served });
      return served;
    },

    /** Attempt `key` in the next cycle, from a clean slate, as a changed config would. */
    retryNow(key) {
      const s = byKey.get(key);
      if (s) s.retry = true;
    },

    /** Drop the state of every integration not in `keys` (removed or disabled). */
    retain(keys) {
      const keep = new Set(keys);
      for (const key of byKey.keys()) if (!keep.has(key)) byKey.delete(key);
    },
  };
}
