// @ts-check
/**
 * The single outbound-fetch chokepoint: SSRF-revalidated redirect following, an
 * allowlist of the headers that may follow a redirect to another origin, no
 * cross-origin redirect at all for a request with a credential in its URL or a
 * body to re-send, and a response-body size cap. Both safeFetch wrappers
 * (integrations/lib/http.js and httpClient.js) route through here.
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
 * Warn once per kind of warning and from -> to origin pair. Logs origins and
 * header NAMES only, never values: origins carry no path or query, so no
 * query-string key reaches the log.
 * @param {string} kind
 * @param {string} from
 * @param {string} to
 * @param {Record<string, unknown>} fields
 * @param {string} msg
 */
function warnRedirectOnce(kind, from, to, fields, msg) {
  const key = `${kind} ${from} ${to}`;
  if (warnedPairs.has(key)) return;
  if (warnedPairs.size >= WARNED_PAIRS_MAX) {
    warnedPairs.delete(/** @type {string} */ (warnedPairs.values().next().value));
  }
  warnedPairs.add(key);
  log.warn({ from, to, ...fields }, msg);
}

/**
 * Refuse a redirect: warn once per origin pair, then throw. The message names
 * the two origins only, so it is as safe to return to the browser as to log.
 * @param {string} reason short and stable; logged as `refused`
 * @param {URL} prev
 * @param {URL} next
 * @param {string} why
 * @param {Record<string, unknown>} [fields] more to log (never a value)
 * @returns {never}
 */
function refuseRedirect(reason, prev, next, why, fields = {}) {
  const msg = `redirected ${prev.origin} → ${next.origin}; ${why}`;
  warnRedirectOnce(`refused ${reason}`, prev.origin, next.origin, { refused: reason, ...fields }, msg);
  throw new Error(msg);
}

// Responses that answered a request which had left its origin on a redirect
// (the http -> https upgrade to the same host and port excepted, see fetchSafe).
// Past that hop the request carried no credential header, no URL credential and
// no body, so a 401 or 403 there refused a request without the caller's
// credentials, not the credentials themselves (#239).
/** @type {WeakSet<object>} */
const offOrigin = new WeakSet();

/**
 * Whether `res`, from fetchSafe, answered a request that a redirect took to
 * another origin, so that it no longer carried the caller's credentials.
 * @param {unknown} res
 * @returns {boolean}
 */
export function leftOrigin(res) {
  return typeof res === 'object' && res !== null && offOrigin.has(res);
}

/**
 * Whether fetch can send this request body again for a 307/308: the body types
 * it serialises afresh for each request. Anything else (a ReadableStream, a Node
 * stream, an async iterable) was read by the first request and is gone.
 * @param {unknown} body
 */
function isReplayable(body) {
  return typeof body === 'string' || body instanceof ArrayBuffer || ArrayBuffer.isView(body) ||
    body instanceof URLSearchParams || body instanceof Blob || body instanceof FormData;
}

/**
 * @param {string} url
 * @param {RequestInit} [opts]
 * @param {{ trusted?: boolean, maxBytes?: number, dispatcher?: any, credentialInUrl?: boolean }} [cfg]
 *   credentialInUrl: the URL itself carries a credential (an integration's
 *   query-string key, or a {token} in its endpoint), so a redirect to another
 *   origin is refused rather than followed. Set by whoever builds the URL.
 * @returns {Promise<Response>}
 */
export async function fetchSafe(url, opts = {}, cfg = {}) {
  const { trusted = false, maxBytes = MAX_BODY_BYTES, dispatcher, credentialInUrl = false } = cfg;
  let current = url;
  let method = String(opts.method || 'GET').toUpperCase();
  let body = opts.body;
  const headers = new Headers(opts.headers || {});
  // Whether a hop has left the request's origin; see leftOrigin.
  let crossed = false;

  for (let hop = 0; ; hop++) {
    assertSafeUrl(current, { trusted }); // re-validate EVERY hop, not just the first
    const res = await fetch(current, {
      ...opts, method, body, headers, redirect: 'manual',
      ...(dispatcher ? { dispatcher } : {}),
    });
    const canHeaders = res.headers && typeof res.headers.get === 'function';
    const location = res.status >= 300 && res.status < 400 && canHeaders && res.headers.get('location');
    if (!location) {
      const out = await capBody(res, maxBytes);
      if (crossed) offOrigin.add(out);
      return out;
    }

    if (hop >= MAX_HOPS) throw new Error('too many redirects');
    const prev = new URL(current);
    const next = new URL(location, prev);
    // Whether this hop stays on the request's origin. Only a hop that does keeps
    // every header, and may carry on a URL credential or re-send a body.
    //
    // One exception counts as staying: an http -> https upgrade to the same host
    // and port (a reverse proxy's force-SSL; the UI and preset placeholders steer
    // users to http://). URL.host is the normalised hostname plus a non-default
    // port, so this matches exactly http://h -> https://h (80 -> 443) and
    // http://h:P -> https://h:P; not a port change, another host, a subdomain or
    // any https -> http downgrade. Whatever the request carries was just sent in
    // clear text to that same host, so sending it there again over TLS discloses
    // nothing new (Python requests' should_strip_auth makes the same exception
    // for the default ports).
    const upgrade = prev.protocol === 'http:' && next.protocol === 'https:' && prev.host === next.host;
    const keepAll = next.origin === prev.origin || upgrade;
    if (!keepAll) crossed = true;

    // A credential in the URL (a query-auth preset's key, a {token} endpoint)
    // can't be stripped from the hop the way a header can: the Location may
    // repeat the query on the new origin. So such a request follows no redirect
    // off its origin at all; the user configures the final URL instead.
    if (credentialInUrl && !keepAll) {
      refuseRedirect('credential in URL', prev, next,
        "not following a redirect to another origin because this integration's credential is " +
        'in the URL; configure the final URL instead');
    }

    // What the status does to the method and body:
    // - 307/308 keep both, as the spec requires. The body goes only where the
    //   request was going (the same origin, or the upgrade above): to another
    //   origin the redirect is refused, so a session login's username and
    //   password are never re-sent to a host nobody configured. A request with
    //   no body (GET, HEAD, a bare DELETE) follows anywhere with its method. A
    //   streamed body was consumed by the first request, so it is refused too.
    // - 303 becomes a GET without a body, whatever the method.
    // - 301/302, and a Location on any other 3xx, turn every method but GET and
    //   HEAD into a GET without a body. Browsers and fetch do that for POST; it
    //   is applied to PUT, PATCH and DELETE too, so these codes never re-send a
    //   body.
    const status = res.status;
    if (status === 307 || status === 308) {
      if (body != null) {
        if (!keepAll) {
          refuseRedirect('request body', prev, next,
            `refusing to re-send a request body to another origin (HTTP ${status})`, { status });
        }
        if (!isReplayable(body)) throw new Error(`cannot re-send a streamed request body on a ${status} redirect`);
      }
    } else if (status === 303 || (method !== 'GET' && method !== 'HEAD')) {
      method = 'GET';
      body = undefined;
      headers.delete('content-type');
      headers.delete('content-length');
    }

    // Never carry credential headers across an origin boundary: past one, only
    // CROSS_ORIGIN_SAFE_HEADERS survive. Dropped headers stay dropped for the
    // rest of the chain, even if a later hop returns to the first origin; the
    // upgrade exception only skips the deletion, it never re-adds a header.
    const unsafe = [...headers.keys()].filter((h) => !CROSS_ORIGIN_SAFE.has(h));
    if (!keepAll) {
      for (const h of unsafe) headers.delete(h);
      if (unsafe.length) {
        warnRedirectOnce('dropped', prev.origin, next.origin, { dropped: unsafe.length, headers: unsafe },
          `redirected ${prev.origin} → ${next.origin}; ${unsafe.length} headers not forwarded`);
      }
    } else if (upgrade && (unsafe.length || credentialInUrl || body != null)) {
      // The upgrade is followed, but its first hop went out in clear text: say
      // so for whatever it carried (credential headers, a key in the URL, a body).
      warnRedirectOnce('upgrade', prev.origin, next.origin,
        { kept: unsafe.length, headers: unsafe, credentialInUrl, body: body != null },
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
