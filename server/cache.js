/**
 * In-memory response cache + ETag helper.
 *
 * The background refresh loop keeps the cache warm; the TTL is a safety net
 * for when a refresh cycle is slow or fails. Routes read from the cache and
 * fall back to on-demand refresh on cold start.
 *
 * jsonWithEtag() sends a cached value with an ETag (an MD5 of its JSON body) so
 * clients can revalidate cheaply via If-None-Match → 304 Not Modified. The body
 * and ETag are computed once per cached value, never per request: setCache
 * serializes the keys served this way (respondWarmCached registers them) when
 * it writes them, and every request after that reads both from the entry.
 */

import crypto from 'crypto';

const CACHE_TTL_MS = 120_000;
// Hard cap on distinct keys. Cache keys include user-influenced strings
// (`prom-<q>`, `weather-<lat>-<lon>`), so an unbounded Map is a trivial
// memory-exhaustion DoS for an authenticated user. Map preserves insertion
// order, so evicting the first key is a simple FIFO bound.
const MAX_ENTRIES = 500;

const cache = new Map();
// Keys served through respondWarmCached (a constant handful). setCache serializes
// these when it writes them; the rest (prom-<q>, weather-<lat>-<lon>, ...) are
// served with res.json and never pay for a body or an ETag.
const etagKeys = new Set();

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

/**
 * Store a value in the cache with the current timestamp. The value must not be
 * mutated afterwards: a key served with an ETag keeps the JSON it had when written.
 */
export function setCache(key, data) {
  const entry = { data, ts: Date.now(), body: null, etag: null };
  if (etagKeys.has(key)) serialize(entry);
  boundedSet(cache, key, entry);
}

/** Fill in `entry.body` (the JSON as a Buffer) and its strong `entry.etag`. */
function serialize(entry) {
  entry.body = Buffer.from(JSON.stringify(entry.data));
  entry.etag = `"${crypto.createHash('md5').update(entry.body).digest('hex')}"`;
  return entry;
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
 * Whether an If-None-Match header matches `etag` (RFC 9110 §13.1.2): `*`, or a
 * list of entity-tags compared weakly (a `W/` prefix is ignored). The request's
 * Cache-Control is deliberately not consulted: browsers add `no-cache` to every
 * fetch that sets its own If-None-Match (useData.js does), and the server is the
 * origin, so answering 304 is the revalidation that header asks for.
 */
function ifNoneMatchHits(header, etag) {
  if (typeof header !== 'string') return false;
  if (header.trim() === '*') return true;
  for (const part of header.split(',')) {
    const tag = part.trim();
    if (tag === etag || tag === `W/${etag}`) return true;
  }
  return false;
}

/**
 * Send a JSON response with ETag/304 support.
 *
 * Clients that send a matching If-None-Match header receive a 304 and skip
 * the response body entirely. When `data` is the value cached under
 * `cacheKey`, the entry's body and ETag are used (and kept, if this is the
 * first time it is served); any other value is serialized for this response.
 */
export function jsonWithEtag(res, req, cacheKey, data) {
  const entry = cache.get(cacheKey);
  const { body, etag } =
    entry && entry.data === data ? (entry.body ? entry : serialize(entry)) : serialize({ data });

  res.set('ETag', etag);
  if (ifNoneMatchHits(req.headers['if-none-match'], etag)) {
    return res.status(304).end();
  }

  res.set('Content-Type', 'application/json');
  res.send(body);
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
 * @param {string} opts.key            cache key (also the ETag key); a constant,
 *   since setCache serializes this key on every write from then on
 * @param {() => Promise<*>} opts.refresh  cold-start refresh; returns the
 *   payload or a falsy value if data isn't available yet.
 * @param {(res: import('express').Response) => *} opts.fallback  invoked when
 *   neither the cache nor the refresh produced data.
 */
export async function respondWarmCached(req, res, { key, refresh, fallback }) {
  etagKeys.add(key); // before refresh(), so its setCache serializes the value
  const cached = getCached(key);
  if (cached) return jsonWithEtag(res, req, key, cached);

  const data = await refresh();
  if (data) return jsonWithEtag(res, req, key, data);

  return fallback(res);
}
