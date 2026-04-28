/**
 * In-memory response cache for integration data.
 *
 * Module-level Map: instantiated once on first import, lives for the process
 * lifetime. Each entry is { data, ts } where ts is the millisecond timestamp
 * of the write. Entries past CACHE_TTL are evicted lazily on next read.
 */

const cache = new Map();
const CACHE_TTL = 30_000; // 30 seconds

export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

export function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}
