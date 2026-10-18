// @ts-check
/**
 * The single outbound-fetch chokepoint: SSRF-revalidated redirect following, an
 * allowlist of the headers that may follow a redirect to another origin, and a
 * response-body size cap. Both safeFetch wrappers (integrations/lib/http.js and
 * httpClient.js) route through here.
 *
 * Why redirect:'manual' + follow-in-code: Node's global fetch follows 3xx
 * transparently, so a guard that only runs on the INITIAL url is bypassed by a
 * target returning `302 Location: http://169.254.169.254/...`. We re-run
 * assertSafeUrl on every hop. (Verified: undici's fetch exposes the Location header
 * under redirect:'manual', so we can resolve + re-validate each hop ourselves.)
 *
 * Why the body cap: a compromised/malicious integration target can return a
 * multi-GB body; an unbounded await res.json()/res.text() would OOM the process.
 * We bound the read here so every caller inherits the cap.
 */
import { assertSafeUrl } from './ssrf.js';
import { createLogger } from './logger.js';

const log = createLogger('safeFetch');

const MAX_HOPS = 5;
/**
 * The only request headers that follow a redirect to a different origin (scheme,
 * host or port differs); every other header is dropped there. The one exception,
 * an http -> https upgrade to the same host and port, is explained in fetchSafe.
 * An allowlist, not a denylist: integration presets put credentials in headers of
 * their own (X-Gotify-Key, X-Plex-Token, NC-Token, a custom integration's
 * authHeader, ...), and a list of names to strip misses whichever one it doesn't
 * name. These four carry content negotiation and client identity, never a
 * secret. Lowercase, because Headers lowercases names, so matching is
 * case-insensitive.
 */
export const CROSS_ORIGIN_SAFE_HEADERS = Object.freeze([
  'accept', 'accept-encoding', 'content-type', 'user-agent',
]);
const CROSS_ORIGIN_SAFE = new Set(CROSS_ORIGIN_SAFE_HEADERS);
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB — integration payloads are tiny

// Origin pairs already warned about, so a polled integration logs a redirect once
// per process, not once per refresh. Bounded (oldest evicted) so a target that
// redirects to ever-new hosts can't grow it without limit.
const warnedPairs = new Set();
const WARNED_PAIRS_MAX = 256;

/**
 * Warn once per from -> to origin pair. Logs origins and header NAMES only, never
 * values: origins carry no path or query, so no query-string key reaches the log.
 * @param {string} from
 * @param {string} to
 * @param {Record<string, unknown>} fields
 * @param {string} msg
 */
function warnRedirectOnce(from, to, fields, msg) {
  const key = `${from} ${to}`;
  if (warnedPairs.has(key)) return;
  if (warnedPairs.size >= WARNED_PAIRS_MAX) {
    warnedPairs.delete(/** @type {string} */ (warnedPairs.values().next().value));
  }
  warnedPairs.add(key);
  log.warn({ from, to, ...fields }, msg);
}

/**
 * @param {string} url
 * @param {RequestInit} [opts]
 * @param {{ trusted?: boolean, maxBytes?: number, dispatcher?: any }} [cfg]
 * @returns {Promise<Response>}
 */
export async function fetchSafe(url, opts = {}, cfg = {}) {
  const { trusted = false, maxBytes = MAX_BODY_BYTES, dispatcher } = cfg;
  let current = url;
  let method = String(opts.method || 'GET').toUpperCase();
  let body = opts.body;
  const headers = new Headers(opts.headers || {});

  for (let hop = 0; ; hop++) {
    assertSafeUrl(current, { trusted }); // re-validate EVERY hop, not just the first
    const res = await fetch(current, {
      ...opts, method, body, headers, redirect: 'manual',
      ...(dispatcher ? { dispatcher } : {}),
    });
    const canHeaders = res.headers && typeof res.headers.get === 'function';
    const location = res.status >= 300 && res.status < 400 && canHeaders && res.headers.get('location');
    if (!location) return capBody(res, maxBytes);

    if (hop >= MAX_HOPS) throw new Error('too many redirects');
    const prev = new URL(current);
    const next = new URL(location, prev);
    // 303, and 301/302 on an unsafe method, become GET with no body (browser rule).
    if (res.status === 303 || (method !== 'GET' && method !== 'HEAD')) {
      method = 'GET';
      body = undefined;
      headers.delete('content-type');
      headers.delete('content-length');
    }
    // Never carry credentials across an origin boundary on a redirect: past one,
    // only CROSS_ORIGIN_SAFE_HEADERS survive. Dropped headers stay dropped for the
    // rest of the chain, even if a later hop returns to the first origin.
    //
    // One exception: an http -> https upgrade to the same host and port keeps every
    // header (a reverse proxy's force-SSL; the UI and preset placeholders steer
    // users to http://). URL.host is the normalised hostname plus a non-default
    // port, so this matches exactly http://h -> https://h (80 -> 443) and
    // http://h:P -> https://h:P; not a port change, another host, a subdomain or
    // any https -> http downgrade. The headers were just sent in clear text to
    // that same host, so forwarding them to it over TLS discloses nothing new
    // (Python requests' should_strip_auth makes the same exception for the
    // default ports). It only skips the deletion: a header dropped on an earlier
    // hop is never re-added.
    const upgrade = prev.protocol === 'http:' && next.protocol === 'https:' && prev.host === next.host;
    const keepAll = next.origin === prev.origin || upgrade;
    const unsafe = [...headers.keys()].filter((h) => !CROSS_ORIGIN_SAFE.has(h));
    if (!keepAll) {
      for (const h of unsafe) headers.delete(h);
      if (unsafe.length) {
        warnRedirectOnce(prev.origin, next.origin, { dropped: unsafe.length, headers: unsafe },
          `redirected ${prev.origin} → ${next.origin}; ${unsafe.length} headers not forwarded`);
      }
    } else if (upgrade && unsafe.length) {
      warnRedirectOnce(prev.origin, next.origin, { kept: unsafe.length, headers: unsafe },
        `redirected ${prev.origin} → ${next.origin}; configure ${next.origin}, ` +
        'credentials are sent in clear text on the first hop');
    }
    current = next.toString();
  }
}

/**
 * Read a response body with a hard byte cap, returning a re-usable Response.
 * @param {Response} res
 * @param {number} maxBytes
 * @returns {Promise<Response>}
 */
async function capBody(res, maxBytes) {
  const declared =
    res.headers && typeof res.headers.get === 'function'
      ? Number(res.headers.get('content-length'))
      : 0;
  if (declared && declared > maxBytes) {
    throw new Error(`response too large (${declared} bytes > ${maxBytes} cap)`);
  }
  // Pass through anything that isn't a real readable stream (empty body, or a
  // partial mock in tests) — production fetch responses always expose getReader.
  if (!res.body || typeof res.body.getReader !== 'function') return res;
  const reader = res.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* already closing */ }
      throw new Error(`response too large (>${maxBytes} byte cap)`);
    }
    chunks.push(value);
  }
  // Rebuild a Response over the bounded buffer so callers' res.json()/text() still
  // work; drop content-encoding/length (the body is already decoded + re-sized).
  const headers = new Headers(res.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(Buffer.concat(chunks), {
    status: res.status, statusText: res.statusText, headers,
  });
}
