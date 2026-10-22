/**
 * In-memory response cache + ETag helper.
 *
 * The background refresh loop keeps the cache warm; the TTL is a safety net
 * for when a refresh cycle is slow or fails. Routes read from the cache and
 * fall back to on-demand refresh on cold start.
 *
 * jsonWithEtag() sends a cached value with an ETag (an MD5 of its JSON body) so
 * clients can revalidate cheaply via If-None-Match → 304 Not Modified. The body
 * and ETag are computed once per cached value, on its first request, and kept on
 * the cache entry, so later requests (200 or 304) send them from memory until the
 * next setCache replaces the entry. A value nobody requests is never serialized.
 */

import crypto from 'crypto';

// How long an entry counts as fresh, unless it was written with its own TTL.
export const CACHE_TTL_MS = 120_000;
// Hard cap on distinct keys. Cache keys include user-influenced strings
// (`weather-<lat>-<lon>`), so an unbounded Map is a trivial
// memory-exhaustion DoS for an authenticated user. Map preserves insertion
// order and boundedSet re-inserts on every write, so the first key is the least
// recently written one: the keys the refresh loop rewrites are never evicted.
const MAX_ENTRIES = 500;

const cache = new Map();

function boundedSet(map, key, value) {
  map.delete(key); // re-insert: Map order = last-write order, so rewritten keys stay newest
  if (map.size >= MAX_ENTRIES) map.delete(map.keys().next().value);
  map.set(key, value);
}

function freshEntry(key) {
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.ts >= entry.ttlMs) return null;
  return entry;
}

/** Get a cached value or null if expired/absent. */
export function getCached(key) {
  const entry = freshEntry(key);
  return entry ? entry.data : null;
}

/**
 * What setCache kept beside a value for readers in this process, or null if
 * expired/absent. It is never served: it is in neither the JSON nor its ETag.
 */
export function getCachedInternal(key) {
  const entry = freshEntry(key);
  return entry ? entry.internal : null;
}

/**
 * Store a value in the cache with the current timestamp. The value must not be
 * mutated afterwards: once served with an ETag, its JSON is kept until the next
 * setCache for the key. `internal` is kept beside it, unserved, for
 * getCachedInternal, and expires with it. `ttlMs` is how long it stays fresh
 * (CACHE_TTL_MS by default): the status the loop builds lives two refresh
 * intervals, so a long interval leaves no gap between cycles.
 */
export function setCache(key, data, internal = null, { ttlMs = CACHE_TTL_MS } = {}) {
  boundedSet(cache, key, { data, internal, ts: Date.now(), ttlMs, body: null, etag: null });
}

/** Fill in `entry.body` (the JSON as a Buffer) and its strong `entry.etag`. */
function serialize(entry) {
  entry.body = Buffer.from(JSON.stringify(entry.data));
  entry.etag = `"${crypto.createHash('md5').update(entry.body).digest('hex')}"`;
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
export function ifNoneMatchHits(header, etag) {
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
 * `cacheKey`, the entry's body and ETag are used (computed and kept on the
 * entry, if this is the first time it is served); any other value is
 * serialized for this response only.
 *
 * With `lastModified` (/api/status, #499), the cached value goes out with its
 * entry's time as Last-Modified, on the 200 and the 304 alike: when setCache
 * stored it, which for the status is when the loop built it. Each cycle
 * stores its status again, so the time moves on every cycle while an equal
 * status keeps its ETag: the time is a header, never in the body. An HTTP date
 * counts whole seconds, so it is up to a second early, which an age shown in
 * seconds or minutes can bear. A value that isn't the cached one has no entry
 * time to vouch for it, and gets none. The ETag stays the only validator: an
 * If-Modified-Since is dropped from the request, so Express's freshness check
 * (res.send) can't answer it alone with a 304 for a status built since.
 */
export function jsonWithEtag(res, req, cacheKey, data, { lastModified = false } = {}) {
  let entry = cache.get(cacheKey);
  if (!entry || entry.data !== data) entry = { data }; // not the cached value: this response only
  if (!entry.body) serialize(entry);
  const { body, etag } = entry;

  res.set('ETag', etag);
  if (lastModified && entry.ts != null) {
    res.set('Last-Modified', new Date(entry.ts).toUTCString());
    delete req.headers['if-modified-since'];
  }
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
