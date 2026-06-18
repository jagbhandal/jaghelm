/**
 * Login rate limiter.
 *
 * Tracks failed login attempts per client identifier (IP) within a sliding
 * 15-minute window. After 5 failures the bucket locks until the window
 * expires. A successful login resets the bucket immediately.
 *
 * Note: client identification is the caller's responsibility (req.ip).
 * Behind a reverse proxy this requires `app.set('trust proxy', ...)` to be
 * configured correctly — see KNOWN-ISSUES.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

const attempts = new Map(); // key → { count, firstAttempt }

// .unref() so this housekeeping timer never keeps the process alive on its own
// (lets the process — and route tests that import the app — exit cleanly).
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of attempts) {
    if (now - record.firstAttempt > WINDOW_MS) {
      attempts.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * Record an attempt against `key` and return true if it's allowed.
 * Returns false once the bucket is locked.
 */
export function checkLoginRate(key) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || now - record.firstAttempt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAttempt: now });
    return true;
  }
  record.count++;
  return record.count <= MAX_ATTEMPTS;
}

/** Clear the bucket for `key` — call after a successful login. */
export function resetLoginRate(key) {
  attempts.delete(key);
}
