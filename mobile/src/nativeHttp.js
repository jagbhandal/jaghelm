import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getApiBase } from '@shared/api/baseUrl.js';

/**
 * Default transport = Capacitor native HTTP. With `CapacitorHttp.enabled: true`
 * in capacitor.config.ts, Capacitor patches window.fetch at native runtime so
 * apiFetch leaves the WebView (bypassing CORS). This module is the single seam
 * where the app adjusts that transport.
 *
 * Conditional GETs to the backend (an `If-None-Match` header on a URL at the
 * origin of getApiBase(), i.e. every dashboard poll after the first load) are
 * sent through the CapacitorHttp plugin directly. Capacitor routes a patched GET
 * through a WebView request to its local interceptor, which hands the native
 * answer back as an android.webkit.WebResourceResponse, and that class throws on
 * any 3xx status. A 304 would reach JS as a failed fetch, so every unchanged poll
 * would read as "Can't reach JagHelm". The plugin call returns status, headers
 * and body over the bridge, so a 304 arrives intact. Everything else
 * (unconditional GETs, writes, other hosts, the app's own files) keeps
 * Capacitor's normal path.
 */

// Statuses whose Response must have a null body (the constructor throws otherwise).
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
// Native backstop so an abandoned request can't hold a connection open forever.
// The caller's AbortSignal (12 s in useData.js) settles the promise first.
const NATIVE_TIMEOUT_MS = 15000;
const WRAPPED = Symbol.for('jaghelm.nativeConditionalFetch');

/** True inside the Capacitor app (native HTTP is the transport there). */
export function isNativeHttp() {
  return Capacitor.isNativePlatform();
}

/** Route conditional backend GETs through the native plugin. Idempotent; a no-op in a browser. */
export function installNativeHttp() {
  if (!isNativeHttp() || window.fetch[WRAPPED]) return;
  const baseFetch = window.fetch;
  const fetchWithConditionalGets = (resource, options) => {
    const url = conditionalBackendUrl(resource, options);
    return url ? nativeConditionalGet(url.href, options) : baseFetch(resource, options);
  };
  fetchWithConditionalGets[WRAPPED] = true;
  window.fetch = fetchWithConditionalGets;
}

// The resolved URL when this is a conditional GET to the configured backend,
// else null. Native gets the resolved href: Java's URL can't take a relative or
// protocol-relative string.
function conditionalBackendUrl(resource, options) {
  // apiFetch passes a URL string; anything else keeps the normal path.
  if (typeof resource !== 'string' && !(resource instanceof URL)) return null;
  if ((options?.method || 'GET').toUpperCase() !== 'GET') return null;
  if (!new Headers(options?.headers).has('If-None-Match')) return null;
  try {
    const here = window.location.href;
    const url = new URL(String(resource), here);
    const backend = new URL(getApiBase(), here);
    // A relative base ('/api') is the app's own origin: nothing to bypass there.
    if (!/^https?:$/.test(url.protocol) || backend.origin === window.location.origin) return null;
    return url.origin === backend.origin ? url : null;
  } catch {
    return null;
  }
}

async function nativeConditionalGet(url, options) {
  const signal = options?.signal;
  signal?.throwIfAborted();
  const pending = CapacitorHttp.request({
    url,
    method: 'GET',
    headers: Object.fromEntries(new Headers(options?.headers).entries()),
    connectTimeout: NATIVE_TIMEOUT_MS,
    readTimeout: NATIVE_TIMEOUT_MS,
    // Follow redirects, as the interceptor path does: it opens the same
    // HttpURLConnection without touching instanceFollowRedirects. Stated so a
    // change here is a decision, not a plugin default.
    disableRedirects: false,
  });
  const res = await (signal ? untilAborted(pending, signal) : pending);
  return toResponse(res);
}

// The plugin call can't be cancelled; settle with the signal's reason instead.
function untilAborted(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function toResponse({ status, headers = {}, data }) {
  if (NULL_BODY_STATUSES.has(status)) return new Response(null, { status, headers });
  return new Response(bodyText(data, headers), { status, headers });
}

// The plugin parses a JSON body before handing it over, so a parsed value is
// serialised back. A string goes through as it came: that is a text body, or a
// JSON body the plugin could not parse (empty or malformed, which it returns
// raw), so r.json() throws on it as the browser's Response.json() would. The
// one casualty is a bare JSON string body, which no polled endpoint returns.
function bodyText(data, headers) {
  if (typeof data === 'string') return data;
  const json = (new Headers(headers).get('Content-Type') || '').includes('application/json');
  if (json && data !== undefined) return JSON.stringify(data);
  return data == null ? '' : String(data);
}
