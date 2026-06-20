// @ts-check
/**
 * The single outbound-fetch chokepoint: SSRF-revalidated redirect following + a
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

const MAX_HOPS = 5;
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB — integration payloads are tiny

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
    const next = new URL(location, current);
    const sameOrigin = next.origin === new URL(current).origin;
    // 303, and 301/302 on an unsafe method, become GET with no body (browser rule).
    if (res.status === 303 || (method !== 'GET' && method !== 'HEAD')) {
      method = 'GET';
      body = undefined;
      headers.delete('content-type');
      headers.delete('content-length');
    }
    // Never carry credentials across an origin boundary on a redirect.
    if (!sameOrigin) {
      headers.delete('authorization');
      headers.delete('cookie');
    }
    current = next.toString();
  }
}

/** Read a response body with a hard byte cap, returning a re-usable Response. */
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
