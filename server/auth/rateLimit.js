/**
 * Login rate limiter — defence in depth against credential brute force.
 *
 * Three layers:
 *  1. Per-IP sliding window: after MAX_ATTEMPTS failures in WINDOW_MS the
 *     bucket locks until the window expires; a successful login resets it.
 *  2. Global failure counter: total failed logins across ALL IPs in the
 *     window. Once GLOBAL_MAX is hit, every login is refused until the window
 *     rolls over — this catches an attacker rotating source IPs (incl. a
 *     misconfigured proxy letting X-Forwarded-For be spoofed) that the per-IP
 *     limit alone would miss. With a single admin account, this is effectively
 *     account lockout.
 *  3. Failure delay floor: every failed login waits a jittered minimum before
 *     responding, so a brute-force loop is throttled and the response time
 *     can't be used as a fine-grained credential oracle.
 *
 * Client identification (req.ip) is the caller's responsibility; behind a proxy
 * this needs `app.set('trust proxy', ...)` configured correctly — see KNOWN-ISSUES.
 */
import { createLogger } from '../util/logger.js';

const log = createLogger('auth');

const MAX_ATTEMPTS = 5; // per-IP failures before lock
const WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_MAX = 50; // total failures across all IPs before global lock
const FAILURE_DELAY_MS = 400; // floor delay on a failed login
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

const attempts = new Map(); // key → { count, firstAttempt }
let globalWindow = { count: 0, start: 0 };
let globalLockLogged = false;

// .unref() so this housekeeping timer never keeps the process alive on its own
// (lets the process — and route tests that import the app — exit cleanly).
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of attempts) {
    if (now - record.firstAttempt > WINDOW_MS) attempts.delete(key);
  }
}, CLEANUP_INTERVAL_MS).unref();

const inGlobalWindow = (now) => now - globalWindow.start <= WINDOW_MS;

/**
 * Gate a login attempt for `key` (IP). Returns false once either the per-IP
 * bucket or the global counter is locked.
 */
export function checkLoginRate(key) {
  const now = Date.now();

  // Global lock first — refuses everyone during a distributed brute force.
  if (inGlobalWindow(now) && globalWindow.count >= GLOBAL_MAX) {
    return false;
  }

  const record = attempts.get(key);
  if (!record || now - record.firstAttempt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAttempt: now });
    return true;
  }
  record.count++;
  return record.count <= MAX_ATTEMPTS;
}

/**
 * Record a *failed* login (call on the 401 path). Feeds the global counter and
 * logs once when the global lock trips, so the operator sees a brute-force event.
 */
export function registerLoginFailure() {
  const now = Date.now();
  if (!inGlobalWindow(now)) {
    globalWindow = { count: 0, start: now };
    globalLockLogged = false;
  }
  globalWindow.count++;
  if (globalWindow.count >= GLOBAL_MAX && !globalLockLogged) {
    globalLockLogged = true;
    log.warn(
      { failures: globalWindow.count, windowMs: WINDOW_MS },
      'global login lock engaged — too many failed logins across all clients'
    );
  }
}

/**
 * A jittered floor delay applied to every failed login. Awaited by the login
 * route before returning 401. Jitter keeps the delay from being a precise oracle.
 */
export function loginFailureDelay() {
  const ms = FAILURE_DELAY_MS + Math.floor(Math.random() * 120);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Clear the per-IP bucket for `key` — call after a successful login. */
export function resetLoginRate(key) {
  attempts.delete(key);
}

// Test seam: reset all limiter state between cases.
export function _resetAllLoginRate() {
  attempts.clear();
  globalWindow = { count: 0, start: 0 };
  globalLockLogged = false;
}
