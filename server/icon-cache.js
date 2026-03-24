/**
 * JagHelm Icon Cache
 * 
 * Proxies external icon URLs (jsdelivr CDN) on first request,
 * saves them to data/icon-cache/, and serves locally on all
 * subsequent requests. Icons are set-and-forget — this eliminates
 * 20-30 CDN round-trips on every cold page load.
 * 
 * Cache key: SHA-256 hash of the original URL → {hash}.{ext}
 * 
 * API:
 *   GET /api/icons/cached?url=https://cdn.jsdelivr.net/...
 *     → Serves from cache if available, otherwise proxies + caches
 * 
 * Security:
 *   - Only allows fetching from whitelisted CDN domains (prevents SSRF)
 *   - URL is hashed so cache filenames are safe
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

let cacheDir = '';

/**
 * Initialize the icon cache directory.
 * Call once at boot with the data directory path.
 */
export function initIconCache(dataDir) {
  cacheDir = join(dataDir, 'icon-cache');
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  try {
    const count = readdirSync(cacheDir).filter(f => /\.(svg|png|webp|jpg)$/.test(f)).length;
    console.log('[icon-cache] %d icons cached locally', count);
  } catch {
    console.log('[icon-cache] Ready');
  }
}

/** Hash a URL to a cache-safe filename. */
function urlToHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

/** Get file extension from URL. Defaults to .svg. */
function urlToExt(url) {
  try {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('.png')) return '.png';
    if (pathname.endsWith('.webp')) return '.webp';
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return '.jpg';
    return '.svg';
  } catch {
    return '.svg';
  }
}

/** Map extension to MIME type. */
function extToMime(ext) {
  return { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' }[ext] || 'image/svg+xml';
}

/** Whitelisted CDN domains for icon fetching (prevents SSRF). */
const ALLOWED_DOMAINS = [
  'cdn.jsdelivr.net',
  'raw.githubusercontent.com',
];

/**
 * Express route handler: GET /api/icons/cached?url=...
 * 
 * 1. Validate URL against whitelist
 * 2. Check local cache → serve from disk (cache HIT)
 * 3. Fetch from CDN → save to disk → serve to client (cache MISS)
 * 4. On fetch failure → 502 (errors are never cached)
 */
export async function handleCachedIcon(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing ?url= parameter' });
  }

  // SSRF protection: only allow known CDN domains
  try {
    const parsed = new URL(url);
    if (!ALLOWED_DOMAINS.some(d => parsed.hostname === d)) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const hash = urlToHash(url);
  const ext = urlToExt(url);
  const filepath = join(cacheDir, `${hash}${ext}`);
  const mime = extToMime(ext);

  // Cache HIT — serve from disk
  if (existsSync(filepath)) {
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Icon-Cache', 'HIT');
    return res.sendFile(filepath);
  }

  // Cache MISS — fetch from CDN, cache, serve
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: { 'User-Agent': 'JagHelm/8.0', 'Accept': 'image/svg+xml, image/png, image/*' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({ error: `CDN returned ${response.status}` });
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Write to cache (best-effort — don't fail the response)
    try {
      writeFileSync(filepath, buffer);
    } catch (err) {
      console.warn('[icon-cache] Write failed:', err.message);
    }

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Icon-Cache', 'MISS');
    return res.send(buffer);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'CDN request timed out' });
    }
    return res.status(502).json({ error: 'Failed to fetch from CDN' });
  }
}
