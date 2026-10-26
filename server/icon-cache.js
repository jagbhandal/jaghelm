/**
 * JagHelm Icon Cache
 *
 * Fetches each icon-repository icon from its CDN on the first request, saves it
 * to icon-cache/ in the data dir (JAGHELM_DATA_DIR, default data/), and serves
 * it from there after that. Icons are set-and-forget — this eliminates 20-30
 * CDN round-trips on every cold page load.
 *
 * API:
 *   GET /api/icons/cached?url=https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg
 *     → Serves from cache if available, otherwise fetches + caches
 *
 * The route is unauthenticated (an <img> can't send the auth header), so what
 * anyone who can reach the port can make it fetch and keep is bounded (#255):
 *   - Only icon-repository URLs are fetched (icon-sources.js); anything else is a
 *     403. The URL fetched is the canonical one rebuilt from that allowlist, never
 *     the input, and the cache is keyed by it, so query strings and other
 *     spellings of one icon share one file.
 *   - A redirect is followed only to another accepted URL, MAX_REDIRECTS at most.
 *   - The response must be the image type its extension names, and at most
 *     MAX_ICON_BYTES. A larger icon is not cached: the browser is redirected to the
 *     CDN for it, as it is for one the cache couldn't store.
 *   - The whole cache is capped at JAGHELM_ICON_CACHE_MAX_MB (default 50 MB);
 *     past that the least recently used icon is deleted. The files already on
 *     disk are counted at boot, oldest written first. Every write updates the
 *     in-memory count synchronously, so concurrent requests can't take the cache
 *     over the cap, and concurrent requests for one icon share one fetch.
 *   - At most MAX_ICON_FETCHES upstream fetches run at once and
 *     MAX_QUEUED_ICON_FETCHES more wait for a turn; past that a miss is a 503
 *     with Retry-After. A body is held once, in the chunks it arrived in, until
 *     it is written to disk; every response, a miss's too, is then streamed
 *     from the file. So the icon bodies in memory are at most MAX_ICON_FETCHES ×
 *     MAX_ICON_BYTES (4 MB), however many misses arrive and however slowly
 *     clients read. An icon that wasn't stored is a 302 to the CDN.
 *   - Icons are served with a sandboxing CSP and nosniff, so an SVG opened
 *     directly from JagHelm's origin can't run script.
 *
 * Cache key: SHA-256 hash of the canonical URL → {hash}.{ext}
 */

import { mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import crypto from 'crypto';
import { DATA_DIR } from './util/dataDir.js';
import { atomicWriteFileSync } from './util/atomicWrite.js';
import { envValue } from './env.js';
import { createLogger } from './util/logger.js';
import { VERSION } from './version.js';
import { canonicalIconUrl, rawFallbackUrl, ICON_TYPES } from './icon-sources.js';

const log = createLogger('icon-cache');

const MB = 1024 * 1024;
/**
 * One icon's cap. The median icon is 1-2 KB as SVG and 14-24 KB as PNG; 512 KB
 * takes every selfh.st SVG and WebP and all but about 0.5% of Dashboard Icons'
 * SVGs and PNGs. The rest are sent to the CDN instead of cached.
 */
export const MAX_ICON_BYTES = 512 * 1024;
/** The whole cache's default cap: room for thousands of typical icons, 100 at the per-icon cap. */
export const DEFAULT_ICON_CACHE_MAX_BYTES = 50 * MB;
const FETCH_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;
/**
 * Upstream fetches at once. A browser opens at most 6 connections to one
 * HTTP/1.1 origin, so one browser's cold page load never waits; with the
 * per-icon cap, it bounds the icon bodies in memory to 4 MB.
 */
export const MAX_ICON_FETCHES = 8;
/**
 * Misses that may wait for a fetch slot. Room for several cold page loads at
 * once (or one over HTTP/2) — a dashboard shows tens of icons, the Settings
 * integration gallery about 40 — while each waiting request holds no body.
 */
export const MAX_QUEUED_ICON_FETCHES = 256;
/** Seconds a 503 asks the browser to wait before asking again. */
const BUSY_RETRY_AFTER_S = 5;

/**
 * Sandbox every served icon, independent of the global CSP: an SVG can carry
 * inline script, and a victim can be sent straight to the endpoint. Inline
 * styles stay allowed, as raw.githubusercontent.com allows them, because icon
 * SVGs use <style>.
 */
export const ICON_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

// The cache's own files; .jpg ones were written by versions before #255.
const CACHE_FILE_RE = /^[0-9a-f]{64}\.(svg|png|webp|jpg)$/;
// What atomicWriteFileSync leaves behind when the process dies mid-write.
const TEMP_FILE_RE = /^[0-9a-f]{64}\.(svg|png|webp|jpg)\.tmp\./;

/**
 * The cap: JAGHELM_ICON_CACHE_MAX_MB, or 50 MB when it is unset or not a
 * positive number (which the boot refuses, env.js). `env` is the process's
 * environment unless a test passes its own.
 */
export function resolveIconCacheMaxBytes(env) {
  return Math.floor(envValue('JAGHELM_ICON_CACHE_MAX_MB', env) * MB);
}

/** Headers for a served icon. */
function iconHeaders(mime, cacheState) {
  return {
    'Content-Type': mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Icon-Cache': cacheState,
    'Content-Security-Policy': ICON_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  };
}

/** What res.sendFile() may have set before failing: ours, and the file's own. */
const FILE_HEADERS = [
  ...Object.keys(iconHeaders('', '')),
  'Content-Length', 'ETag', 'Last-Modified', 'Accept-Ranges', 'Content-Range',
];

// Absolute: res.sendFile() refuses a relative path, and JAGHELM_DATA_DIR may be one.
const cacheDirIn = (dataDir) => resolve(dataDir, 'icon-cache');
let cacheDir = cacheDirIn(DATA_DIR);
let maxBytes = resolveIconCacheMaxBytes();
/** File name → size in bytes, least recently used first. */
let entries = new Map();
let totalBytes = 0;
/** File name → the fetch in flight for it, so concurrent requests for one icon share it. */
let inflight = new Map();

/**
 * At most `max` holders at once, and at most `maxQueued` more waiting in order.
 * @param {number} max
 * @param {number} maxQueued
 */
function createLimiter(max, maxQueued) {
  let active = 0;
  /** @type {Array<() => void>} */
  const waiting = [];
  return {
    /** Resolves true with a slot, or false at once when the queue is full. */
    acquire() {
      if (active < max) {
        active++;
        return Promise.resolve(true);
      }
      if (waiting.length >= maxQueued) return Promise.resolve(false);
      return new Promise((resolve) => waiting.push(() => resolve(true)));
    },
    release() {
      const next = waiting.shift();
      if (next) next(); // the slot passes straight to the next in line
      else active--;
    },
  };
}
let fetchSlots = createLimiter(MAX_ICON_FETCHES, MAX_QUEUED_ICON_FETCHES);

/**
 * Delete least recently used files until the cache holds `limit` bytes or less.
 * A file that can't be deleted stays counted, so the cap holds even then.
 * @returns {number} how many were deleted
 */
function evictTo(limit) {
  let evicted = 0;
  for (const [name, size] of entries) {
    if (totalBytes <= limit) break;
    try {
      unlinkSync(join(cacheDir, name));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        log.warn({ err, file: name }, 'could not delete a cached icon');
        break;
      }
    }
    entries.delete(name);
    totalBytes -= size;
    evicted++;
  }
  return evicted;
}

/**
 * Initialize the icon cache directory and count what it holds.
 * Call once at boot; the data dir defaults to JAGHELM_DATA_DIR, like every store.
 * @param {string} [dataDir]
 * @param {{ maxBytes?: number, maxFetches?: number, maxQueued?: number }} [opts] tests set small caps
 */
export function initIconCache(dataDir = DATA_DIR, opts = {}) {
  cacheDir = cacheDirIn(dataDir);
  maxBytes = opts.maxBytes ?? resolveIconCacheMaxBytes();
  entries = new Map();
  totalBytes = 0;
  inflight = new Map();
  fetchSlots = createLimiter(opts.maxFetches ?? MAX_ICON_FETCHES, opts.maxQueued ?? MAX_QUEUED_ICON_FETCHES);
  mkdirSync(cacheDir, { recursive: true });

  let names = [];
  try {
    names = readdirSync(cacheDir);
  } catch (err) {
    log.warn({ err }, 'icon cache unreadable; counting it as empty');
  }
  const found = [];
  for (const name of names) {
    const path = join(cacheDir, name);
    try {
      if (TEMP_FILE_RE.test(name)) unlinkSync(path);
      else if (CACHE_FILE_RE.test(name)) {
        const st = statSync(path);
        if (st.isFile()) found.push({ name, size: st.size, mtimeMs: st.mtimeMs });
      }
    } catch (err) {
      log.warn({ err, file: name }, 'could not read a cached icon; leaving it');
    }
  }
  // Without a record of use across restarts, the oldest written goes first.
  found.sort((a, b) => a.mtimeMs - b.mtimeMs || (a.name < b.name ? -1 : 1));
  for (const f of found) {
    entries.set(f.name, f.size);
    totalBytes += f.size;
  }
  const evicted = evictTo(maxBytes);
  log.info({ count: entries.size, bytes: totalBytes, maxBytes, ...(evicted ? { evicted } : {}) }, 'icons cached locally');
}

/** Tests and the boot log: how full the cache is. */
export function iconCacheStats() {
  return { count: entries.size, bytes: totalBytes, maxBytes };
}

/** Mark a cached file as just used. */
function touch(name) {
  const size = entries.get(name);
  entries.delete(name);
  entries.set(name, size);
}

/** Forget a cached file (it vanished or can't be read). */
function forget(name) {
  const size = entries.get(name);
  if (size === undefined) return;
  entries.delete(name);
  totalBytes -= size;
}

/** Rename a cached file, counting it as just used. False when the file is gone. */
function adopt(from, to) {
  try {
    renameSync(join(cacheDir, from), join(cacheDir, to));
  } catch (err) {
    if (err.code === 'ENOENT') forget(from);
    return false;
  }
  const size = entries.get(from);
  entries.delete(from);
  forget(to);
  entries.set(to, size);
  return true;
}

/**
 * Write an icon into the cache, evicting to make room first. Synchronous from
 * the check to the count, so no other request can interleave.
 * @param {string} name
 * @param {Uint8Array[]} chunks the body, as read
 * @param {number} size their total length
 * @returns {boolean} whether it was stored (no room, or a failed write, isn't)
 */
function admit(name, chunks, size) {
  forget(name);
  if (size > maxBytes) return false;
  evictTo(maxBytes - size);
  if (totalBytes + size > maxBytes) return false;
  try {
    mkdirSync(cacheDir, { recursive: true });
    atomicWriteFileSync(join(cacheDir, name), chunks);
  } catch (err) {
    log.warn({ err }, 'Write failed');
    return false;
  }
  entries.set(name, size);
  totalBytes += size;
  return true;
}

/** Hash a URL to a cache-safe filename. */
function urlToHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

/**
 * Read a body up to `max` bytes, keeping the chunks it arrives in (joining them
 * would hold it twice); null once it is longer.
 * @returns {Promise<{ chunks: Uint8Array[], size: number } | null>}
 */
async function readCapped(res, max) {
  if (!res.body) return { chunks: [], size: 0 };
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      try { await reader.cancel(); } catch { /* already closing */ }
      return null;
    }
    chunks.push(value);
  }
  return { chunks, size };
}

async function discard(res) {
  try { await res.body?.cancel(); } catch { /* nothing to release */ }
}

/** `location` resolved against `base`, or null. */
function resolveLocation(location, base) {
  try {
    return new URL(location, base).href;
  } catch {
    return null;
  }
}

/**
 * Fetch a canonical icon URL and cache it, once a fetch slot is free. Never rejects.
 * @param {string} url canonical (icon-sources.js)
 * @param {string} name its cache file name
 * @returns {Promise<{ cached: true } | { bypass: 'too large' | 'not stored' } | { status: number, error: string, retryAfter?: number }>}
 */
async function fetchAndCache(url, name) {
  const slots = fetchSlots;
  if (!(await slots.acquire())) {
    return { status: 503, error: 'Icon cache busy fetching other icons; try again shortly', retryAfter: BUSY_RETRY_AFTER_S };
  }
  try {
    return await fetchIcon(url, name);
  } finally {
    slots.release();
  }
}

/**
 * The fetch itself, holding a slot. A jsDelivr URL that fails in a way that may
 * pass (a 403 such as "Package size exceeded", a 5xx, a timeout or a network
 * error) is tried once more on raw.githubusercontent.com (#371); a 404 or a
 * wrong file type is not, and the icon is cached under the URL asked for either
 * way. Never rejects.
 * @param {string} url
 * @param {string} name
 */
async function fetchIcon(url, name) {
  const result = await fetchIconFrom(url, name);
  const fallback = 'retry' in result ? rawFallbackUrl(url) : null;
  if (!fallback) return result;
  log.info({ url, status: result.status }, 'CDN refused an icon; trying raw.githubusercontent.com');
  const second = await fetchIconFrom(fallback, name);
  return 'retry' in second ? { status: second.status, error: second.error } : second;
}

/**
 * One attempt at `url`, following redirects to other accepted URLs. `retry` is
 * set on a failure the other host may not share.
 * @param {string} url
 * @param {string} name
 */
async function fetchIconFrom(url, name) {
  const mime = ICON_TYPES[url.slice(url.lastIndexOf('.'))];
  // Started once the slot is held, and covering the body too, not just the headers.
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let current = url;
  try {
    for (let hop = 0; ; hop++) {
      const response = await fetch(current, {
        headers: { 'User-Agent': `JagHelm/${VERSION}`, 'Accept': 'image/svg+xml, image/png, image/webp, image/*' },
        signal,
        // Redirects are followed below, and only to another icon-repository URL,
        // so a CDN that redirects can't send the server anywhere else.
        redirect: 'manual',
      });
      if (response.status >= 300 && response.status < 400) {
        await discard(response);
        if (hop >= MAX_REDIRECTS) return { status: 502, error: 'CDN sent too many redirects' };
        const location = response.headers.get('location');
        const next = location ? canonicalIconUrl(resolveLocation(location, current)) : null;
        if (!next) return { status: 502, error: 'CDN redirected away from the icon repositories' };
        current = next;
        continue;
      }
      if (!response.ok) {
        await discard(response);
        const retry = response.status === 403 || response.status >= 500;
        return { status: 502, error: `CDN returned ${response.status}`, ...(retry ? { retry: true } : {}) };
      }
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (type !== mime) {
        await discard(response);
        return { status: 502, error: 'CDN response is not an icon' };
      }
      const declared = Number(response.headers.get('content-length'));
      if (declared > MAX_ICON_BYTES) {
        await discard(response);
        return { bypass: 'too large' };
      }
      const body = await readCapped(response, MAX_ICON_BYTES);
      if (!body) return { bypass: 'too large' };
      if (!body.size) return { status: 502, error: 'CDN returned an empty icon' };
      // The body is dropped here, once on disk: every response streams the file.
      return admit(name, body.chunks, body.size) ? { cached: true } : { bypass: 'not stored' };
    }
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return { status: 504, error: 'CDN request timed out', retry: true };
    }
    return { status: 502, error: 'Failed to fetch from CDN', retry: true };
  }
}

/**
 * One fetch per icon at a time; later requests for it wait for that one, and so
 * take no fetch slot or place in the queue of their own.
 */
function fetchOnce(url, name) {
  const pending = inflight.get(name);
  if (pending) return pending;
  const map = inflight;
  const p = fetchAndCache(url, name).finally(() => {
    if (map.get(name) === p) map.delete(name);
  });
  map.set(name, p);
  return p;
}

/**
 * Serve a cached file, streamed with backpressure. Resolves false, having sent
 * nothing, when it can't be read (deleted behind the cache's back, say). The
 * file stays counted until a fetch replaces it or eviction deletes it, so a
 * file still on disk is never left out of the total.
 */
function sendCached(res, name, mime, cacheState) {
  return new Promise((done) => {
    // Headers via the option, so they're set only once send has found the file.
    res.sendFile(join(cacheDir, name), { headers: iconHeaders(mime, cacheState) }, (err) => {
      // Sent, or the client went away: nothing more to do.
      if (!err || res.headersSent || err.code === 'ECONNABORTED') return done(true);
      // A file that vanished (evicted, say) between send's stat and its open
      // fails after its headers are set, Content-Length among them: clear them,
      // or the response sent instead would claim the file's length and hang.
      for (const h of FILE_HEADERS) res.removeHeader(h);
      done(false);
    });
  });
}

/**
 * Express route handler: GET /api/icons/cached?url=...
 *
 * 1. Canonicalize the URL against the icon repositories → 403 if it isn't one
 * 2. Check local cache → serve from disk (cache HIT)
 * 3. Fetch from CDN (jsDelivr, then raw.githubusercontent.com if it refuses) →
 *    save to disk → serve to client (cache MISS)
 * 4. Too large, or not stored → 302 to the CDN; too many misses at once → 503
 *    with Retry-After; any other failure → 502/504 (errors are never cached)
 */
export async function handleCachedIcon(req, res) {
  const raw = req.query.url;
  if (typeof raw !== 'string' || !raw) {
    return res.status(400).json({ error: 'Missing or repeated ?url= parameter' });
  }
  const url = canonicalIconUrl(raw);
  if (!url) {
    return res.status(403).json({ error: 'Not an icon repository URL' });
  }
  const ext = url.slice(url.lastIndexOf('.'));
  const mime = ICON_TYPES[ext];
  const name = `${urlToHash(url)}${ext}`;

  // Cache HIT — serve from disk
  if (entries.has(name)) {
    touch(name);
    if (await sendCached(res, name, mime, 'HIT')) return;
  }
  // Before #255 a file was named after the URL exactly as the browser sent it:
  // reuse one under the canonical name instead of fetching it again.
  const asSent = `${urlToHash(raw)}${ext}`;
  if (asSent !== name && entries.has(asSent) && adopt(asSent, name)) {
    if (await sendCached(res, name, mime, 'HIT')) return;
  }

  // Cache MISS — fetch from CDN, cache, serve
  const result = await fetchOnce(url, name);
  if ('cached' in result && (await sendCached(res, name, mime, 'MISS'))) return;
  if ('cached' in result || 'bypass' in result) {
    // Not stored, or already evicted again: the browser gets it from the CDN.
    // An icon too large to cache stays so, so the browser may keep that redirect
    // for a day; the other reasons can pass, so it asks again next time.
    const tooLarge = 'bypass' in result && result.bypass === 'too large';
    res.set({
      'Location': url, 'Cache-Control': tooLarge ? 'public, max-age=86400' : 'no-store',
      'X-Icon-Cache': 'BYPASS', 'Content-Length': '0',
    });
    return res.status(302).end();
  }
  if (result.retryAfter) {
    res.set({ 'Retry-After': String(result.retryAfter), 'Cache-Control': 'no-store' });
  }
  return res.status(result.status).json({ error: result.error });
}
