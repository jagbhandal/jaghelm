/**
 * Generic in-memory sliding-window rate limiter.
 *
 * createRateLimiter({ max, windowMs }) → allow(key): boolean
 * Returns true while `key` has made fewer than `max` calls in the last
 * `windowMs`, false once it's over. Used to throttle abuse-prone endpoints
 * (e.g. the integration connection-test probe, which is a port-scan/SSRF
 * oracle). Distinct keys are FIFO-capped so the map can't grow unbounded.
 */
export function createRateLimiter({ max, windowMs, maxKeys = 5000 }) {
  const hits = new Map(); // key → timestamps[]

  return function allow(key) {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    if (!hits.has(key) && hits.size >= maxKeys) {
      hits.delete(hits.keys().next().value); // FIFO evict to bound memory
    }
    hits.set(key, recent);
    return true;
  };
}
