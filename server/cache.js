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

const cache = new Map();
const etagCache = new Map();

/** Get a cached value or null if expired/absent. */
export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts >= CACHE_TTL_MS) return null;
  return entry.data;
}

/** Store a value in the cache with the current timestamp. */
export function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
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
  etagCache.set(cacheKey, { hash, json });

  const clientEtag = req.headers['if-none-match'];
  if (clientEtag === etag) {
    return res.status(304).end();
  }

  res.set('ETag', etag);
  res.set('Content-Type', 'application/json');
  res.send(json);
}
