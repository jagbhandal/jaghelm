/**
 * In-memory response cache + ETag helper.
 *
 * The background refresh loop keeps the cache warm; the TTL is a safety net
 * for when a refresh cycle is slow or fails. Routes read from the cache and
 * fall back to on-demand refresh on cold start.
 *
 * jsonWithEtag() hashes the response body so clients can revalidate cheaply
 * via If-None-Match → 304 Not Modified.
 */

import crypto from 'crypto';

const CACHE_TTL_MS = 120_000;
// Hard cap on distinct keys. Cache keys include user-influenced strings
// (`prom-<q>`, `weather-<lat>-<lon>`), so an unbounded Map is a trivial
// memory-exhaustion DoS for an authenticated user. Map preserves insertion
// order, so evicting the first key is a simple FIFO bound.
const MAX_ENTRIES = 500;

const cache = new Map();
const etagCache = new Map();

function boundedSet(map, key, value) {
  if (!map.has(key) && map.size >= MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
  map.set(key, value);
}

/** Get a cached value or null if expired/absent. */
export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts >= CACHE_TTL_MS) return null;
  return entry.data;
}

/** Store a value in the cache with the current timestamp. */
export function setCache(key, data) {
  boundedSet(cache, key, { data, ts: Date.now() });
}

/**
 * Age in ms of a cache entry, or null if absent. Used by the metrics layer to
 * publish jaghelm_cache_age_seconds (the data-freshness SLO). Unlike getCached,
 * this does NOT treat an expired entry as missing — staleness is exactly what
 * the freshness metric needs to observe.
 */
export function getCacheAgeMs(key) {
  const entry = cache.get(key);
  return entry ? Date.now() - entry.ts : null;
}

/**
 * Send a JSON response with ETag/304 support.
 *
 * Clients that send a matching If-None-Match header receive a 304 and skip
 * the response body entirely.
 */
export function jsonWithEtag(res, req, cacheKey, data) {
  const json = JSON.stringify(data);
  const hash = crypto.createHash('md5').update(json).digest('hex');
  const etag = `"${hash}"`;
  boundedSet(etagCache, cacheKey, { hash, json });

  const clientEtag = req.headers['if-none-match'];
  if (clientEtag === etag) {
    return res.status(304).end();
  }

  res.set('ETag', etag);
  res.set('Content-Type', 'application/json');
  res.send(json);
}

/**
 * Serve a warm-cached endpoint with a uniform cache-or-refresh-then-fallback
 * contract: return the cached value (ETag/304) if present; otherwise run the
 * cold-start refresh and serve its result (ETag/304); otherwise hand off to
 * the caller's fallback (e.g. an apiError or an empty body).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {object} opts
 * @param {string} opts.key            cache key (also the ETag key)
 * @param {() => Promise<*>} opts.refresh  cold-start refresh; returns the
 *   payload or a falsy value if data isn't available yet.
 * @param {(res: import('express').Response) => *} opts.fallback  invoked when
 *   neither the cache nor the refresh produced data.
 */
export async function respondWarmCached(req, res, { key, refresh, fallback }) {
  const cached = getCached(key);
  if (cached) return jsonWithEtag(res, req, key, cached);

  const data = await refresh();
  if (data) return jsonWithEtag(res, req, key, data);

  return fallback(res);
}
