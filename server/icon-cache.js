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
 *     CDN for it.
 *   - The whole cache is capped at JAGHELM_ICON_CACHE_MAX_MB (default 50 MB);
 *     past that the least recently used icon is deleted. The files already on
 *     disk are counted at boot, oldest written first. Every write updates the
 *     in-memory count synchronously, so concurrent requests can't take the cache
 *     over the cap, and concurrent requests for one icon share one fetch.
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
import { positiveNum } from './util/env.js';
import { createLogger } from './util/logger.js';
import { VERSION } from './version.js';
import { canonicalIconUrl, ICON_TYPES } from './icon-sources.js';

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

/** The cap: JAGHELM_ICON_CACHE_MAX_MB, or 50 MB when it is unset or not a positive number. */
export function resolveIconCacheMaxBytes(env = process.env) {
  return Math.floor(positiveNum(env.JAGHELM_ICON_CACHE_MAX_MB, DEFAULT_ICON_CACHE_MAX_BYTES / MB) * MB);
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
 * @param {{ maxBytes?: number }} [opts] tests set a small cap
 */
export function initIconCache(dataDir = DATA_DIR, opts = {}) {
  cacheDir = cacheDirIn(dataDir);
  maxBytes = opts.maxBytes ?? resolveIconCacheMaxBytes();
  entries = new Map();
  totalBytes = 0;
  inflight = new Map();
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
 * the check to the count, so no other request can interleave. Best-effort: a
 * failed write only means the icon is not cached.
 * @param {string} name
 * @param {Buffer} buffer
 */
function admit(name, buffer) {
  forget(name);
  if (buffer.length > maxBytes) return;
  evictTo(maxBytes - buffer.length);
  if (totalBytes + buffer.length > maxBytes) return;
  try {
    mkdirSync(cacheDir, { recursive: true });
    atomicWriteFileSync(join(cacheDir, name), buffer);
  } catch (err) {
    log.warn({ err }, 'Write failed');
    return;
  }
  entries.set(name, buffer.length);
  totalBytes += buffer.length;
}

/** Hash a URL to a cache-safe filename. */
function urlToHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

/** Read a body up to `max` bytes; null once it is longer. */
async function readCapped(res, max) {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      try { await reader.cancel(); } catch { /* already closing */ }
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
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
 * Fetch a canonical icon URL and cache it. Never rejects.
 * @param {string} url canonical (icon-sources.js)
 * @param {string} name its cache file name
 * @returns {Promise<{ buffer: Buffer } | { tooLarge: true } | { status: number, error: string }>}
 */
async function fetchAndCache(url, name) {
  const mime = ICON_TYPES[url.slice(url.lastIndexOf('.'))];
  // The timeout covers the body too, not just the headers.
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
        const location = response.headers.get('location');
        const next = location && hop < MAX_REDIRECTS ? canonicalIconUrl(resolveLocation(location, current)) : null;
        if (!next) return { status: 502, error: 'CDN redirected away from the icon repositories' };
        current = next;
        continue;
      }
      if (!response.ok) {
        await discard(response);
        return { status: 502, error: `CDN returned ${response.status}` };
      }
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (type !== mime) {
        await discard(response);
        return { status: 502, error: 'CDN response is not an icon' };
      }
      const declared = Number(response.headers.get('content-length'));
      if (declared > MAX_ICON_BYTES) {
        await discard(response);
        return { tooLarge: true };
      }
      const buffer = await readCapped(response, MAX_ICON_BYTES);
      if (!buffer) return { tooLarge: true };
      if (!buffer.length) return { status: 502, error: 'CDN returned an empty icon' };
      admit(name, buffer);
      return { buffer };
    }
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return { status: 504, error: 'CDN request timed out' };
    }
    return { status: 502, error: 'Failed to fetch from CDN' };
  }
}

/** One fetch per icon at a time; later requests for it wait for that one. */
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
 * Serve a cached file. Resolves false, having sent nothing, when it can't be
 * read (deleted behind the cache's back, say): the caller fetches it again. The
 * file stays counted until that fetch replaces it or eviction deletes it, so a
 * file still on disk is never left out of the total.
 */
function sendCached(res, name, mime) {
  return new Promise((done) => {
    // Headers via the option, so they're set only once the file is found.
    res.sendFile(join(cacheDir, name), { headers: iconHeaders(mime, 'HIT') }, (err) => {
      // Sent, or the client went away: nothing more to do.
      done(!err || res.headersSent || err.code === 'ECONNABORTED');
    });
  });
}

/**
 * Express route handler: GET /api/icons/cached?url=...
 *
 * 1. Canonicalize the URL against the icon repositories → 403 if it isn't one
 * 2. Check local cache → serve from disk (cache HIT)
 * 3. Fetch from CDN → save to disk → serve to client (cache MISS)
 * 4. Too large to cache → 302 to the CDN; any other failure → 502/504 (errors are never cached)
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
    if (await sendCached(res, name, mime)) return;
  }
  // Before #255 a file was named after the URL exactly as the browser sent it:
  // reuse one under the canonical name instead of fetching it again.
  const asSent = `${urlToHash(raw)}${ext}`;
  if (asSent !== name && entries.has(asSent) && adopt(asSent, name)) {
    if (await sendCached(res, name, mime)) return;
  }

  // Cache MISS — fetch from CDN, cache, serve
  const result = await fetchOnce(url, name);
  if ('buffer' in result) {
    res.set(iconHeaders(mime, 'MISS'));
    return res.send(result.buffer);
  }
  if ('tooLarge' in result) {
    res.set({ 'Location': url, 'Cache-Control': 'public, max-age=86400', 'X-Icon-Cache': 'BYPASS' });
    return res.status(302).end();
  }
  return res.status(result.status).json({ error: result.error });
}
