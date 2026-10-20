/**
 * Per-integration retry state for the refresh loop (#239).
 *
 * Every integration used to be fetched every cycle however long it had been
 * failing, each dead one holding one of the fetch slots for up to the 8 s
 * timeout, and a refused login was sent again every cycle, forever (an app that
 * bans an address after failed logins would ban JagHelm's).
 *
 * Now each integration is in one of three states:
 *
 * - `ok`: its last attempt succeeded. It is fetched every cycle.
 * - `backing_off`: its last attempts failed. The next one waits 30 s after the
 *   first failure, then 1, 2, 4 and 8 min, then every 10 min, and a success
 *   resets that.
 * - `auth_failed`: its login was refused on two attempts in a row (a refused
 *   login is `authRejected` from fetchIntegration: a 401 or 403 to the session
 *   login, or to a request that carried its credentials). It is not attempted
 *   again until its config changes. A single refusal only backs off: a proxy,
 *   a WAF challenge or an app answering 403 while it rate-limits can refuse
 *   once without the credentials being wrong, and the next attempt, 30 s on,
 *   recovers from that by itself. Any other outcome in between starts the count
 *   again. A wrong password so costs two attempts per config, well under the
 *   failures apps such as qBittorrent and fail2ban allow before banning.
 *
 * "Its config" is the fingerprint the caller passes (configFingerprint in
 * lib/config.js): its entry in services.yaml with its credentials resolved, so
 * a hand edit (the config watcher), a save in Settings and a new stored secret
 * each count. An attempt whose fingerprint differs from the last one's starts
 * from a clean slate, and so does the first attempt after retryNow (the
 * Settings save calls it, so saving unchanged is the way to say "try again").
 * A retryNow made while an attempt is in flight is kept for the next attempt.
 * The state is in memory: a restart attempts every integration again.
 *
 * While an integration is not due, the caller serves the entry its last attempt
 * left (held), as the failure was served when it happened: its `_error` and
 * nothing fetched, so the dashboard shows it as it does a failed fetch. A parked
 * integration's `_error` ends with a fixed hint saying how to retry it. Every
 * entry carries `_status: { state, since, failures, nextAttemptAt }`: `since`
 * is when the state began, `failures` the failed attempts in a row under this
 * config, and `nextAttemptAt` when it will be attempted again (null when ok, as
 * it is attempted every cycle, or auth failed, as it waits for a config
 * change). `since` and `nextAttemptAt` are wall-clock ms since the epoch, set
 * once when an attempt is recorded, so they don't change between attempts and
 * the payload's ETag holds. Whether an attempt is due is worked out on a
 * monotonic clock instead, so a step of the wall clock (NTP) neither holds an
 * integration longer nor retries it early.
 */

export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 10 * 60_000;
/** Refused logins in a row, under one config, that park an integration. */
export const REJECTIONS_TO_PARK = 2;
// A cycle is timed by an interval timer and the attempt times by the cycle's
// start, so a cycle can start a moment before an attempt is due: it still
// makes the attempt rather than waiting a whole extra interval.
const DUE_SLACK_MS = 1_000;

/**
 * The hint appended to a parked integration's `_error`: how to have it retried.
 * Fixed text, never a credential or URL, so the ETag holds. `settings` is for an
 * entry exactly as a save in Settings writes it (savedFromSettings in
 * lib/config.js), which saving again keeps; `file` for one written by hand,
 * which a save in Settings would rebuild and lose parts of (#402).
 */
export const PARKED_HINT = Object.freeze({
  settings: 'login refused twice; not retried until it is saved in Settings',
  file: 'login refused twice; not retried until services.yaml changes or JagHelm restarts',
});

/** The wait after `failures` failed attempts in a row: 30 s doubling, at most 10 min. */
export function backoffDelayMs(failures) {
  if (failures < 1) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
}

/**
 * When a cycle started, on both clocks: `wall` (Date.now()) for the times the
 * payload shows, `mono` (performance.now()) for when an attempt is due.
 * @typedef {{ wall: number, mono: number }} CycleTime
 */

/**
 * @param {{ logger?: { warn: Function, info: Function } }} [opts]
 */
export function createIntegrationBackoff({ logger } = {}) {
  // key -> { fingerprint, state, since, failures, nextAttemptAt, dueAt,
  //          rejections, entry, retry?, retrySince?, retryAt? }
  // dueAt is nextAttemptAt on the monotonic clock; rejections the refused
  // logins in a row; retrySince and retryAt the first and last retryNow (on the
  // monotonic clock) not yet taken up by an attempt.
  const byKey = new Map();

  return {
    /**
     * The entry to serve for `key` this cycle without fetching it, or null when
     * it is to be attempted: it is new, ok, due, retried, or its config changed.
     * @param {string} key
     * @param {string | null} fingerprint
     * @param {CycleTime} at
     */
    held(key, fingerprint, at) {
      const s = byKey.get(key);
      if (!s || s.state === 'ok' || s.retry || s.fingerprint !== fingerprint) return null;
      if (s.state === 'backing_off' && at.mono >= s.dueAt - DUE_SLACK_MS) return null;
      return s.entry;
    },

    /**
     * Record an attempt made in the cycle that started `at` and return its entry
     * with `_status`. It failed when the entry has an `_error`. The entry is
     * kept to be served again until the next attempt, so it must not be
     * mutated afterwards.
     * @param {string} key
     * @param {string | null} fingerprint
     * @param {Record<string, unknown>} entry
     * @param {{ authRejected?: boolean, savedFromSettings?: boolean }} outcome
     *   authRejected: the login was refused. savedFromSettings: the entry is as
     *   a save in Settings writes it, which picks the hint a parked one gets.
     * @param {CycleTime} at
     */
    record(key, fingerprint, entry, { authRejected = false, savedFromSettings = false } = {}, at) {
      const prev = byKey.get(key);
      // A retryNow from before this attempt began is what made it: it starts
      // from a clean slate. One from after it began (a save in Settings while
      // the fetch was in flight) is for the next attempt, so it is carried over;
      // otherwise this attempt's outcome would overwrite it and the save would be
      // lost.
      const retried = !!prev?.retry && prev.retrySince < at.mono;
      const retryPending = !!prev?.retry && prev.retryAt >= at.mono;
      // The same config's earlier failures count; a changed config, or a
      // retry, starts over.
      const carried = prev && !retried && prev.fingerprint === fingerprint ? prev : null;
      let next;
      let dueAt = null;
      let rejections = 0;
      let served;
      if (!entry._error) {
        if (prev?.state && prev.state !== 'ok')
          logger?.info({ key, failures: prev.failures }, 'integration recovered');
        next = {
          state: 'ok',
          since: prev?.state === 'ok' ? prev.since : at.wall,
          failures: 0,
          nextAttemptAt: null,
        };
        served = { ...entry };
      } else {
        const failures = (carried?.failures || 0) + 1;
        rejections = authRejected ? (carried?.rejections || 0) + 1 : 0;
        if (rejections >= REJECTIONS_TO_PARK) {
          logger?.warn(
            { key, error: entry._error },
            'integration login refused twice; not retrying until its config changes'
          );
          next = { state: 'auth_failed', since: at.wall, failures, nextAttemptAt: null };
          const hint = savedFromSettings ? PARKED_HINT.settings : PARKED_HINT.file;
          served = { ...entry, _error: `${entry._error} (${hint})` };
        } else {
          const delay = backoffDelayMs(failures);
          const since = carried?.state === 'backing_off' ? carried.since : at.wall;
          next = { state: 'backing_off', since, failures, nextAttemptAt: at.wall + delay };
          dueAt = at.mono + delay;
          served = { ...entry };
        }
      }
      served._status = { ...next };
      const state = { fingerprint, ...next, dueAt, rejections, entry: served };
      if (retryPending) {
        Object.assign(state, { retry: true, retrySince: prev.retryAt, retryAt: prev.retryAt });
      }
      byKey.set(key, state);
      return served;
    },

    /**
     * Attempt `key` in the next cycle, from a clean slate, as a changed config
     * would. `mono` is now on the monotonic clock (performance.now()), so that
     * a retry asked for while an attempt is in flight outlives that attempt.
     * @param {string} key
     * @param {number} mono
     */
    retryNow(key, mono) {
      const s = byKey.get(key);
      if (!s) return;
      if (!s.retry) s.retrySince = mono;
      s.retry = true;
      s.retryAt = mono;
    },

    /** Drop the state of every integration not in `keys` (removed or disabled). */
    retain(keys) {
      const keep = new Set(keys);
      for (const key of byKey.keys()) if (!keep.has(key)) byKey.delete(key);
    },
  };
}
