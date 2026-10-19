import { Capacitor, CapacitorHttp } from '@capacitor/core';

/**
 * Default transport = Capacitor native HTTP. With `CapacitorHttp.enabled: true`
 * in capacitor.config.ts, Capacitor patches window.fetch at native runtime so
 * apiFetch leaves the WebView (bypassing CORS). This module is the single seam
 * where the app adjusts that transport.
 *
 * Conditional GETs (an `If-None-Match` header, i.e. every dashboard poll after
 * the first load) are sent through the CapacitorHttp plugin directly. Capacitor
 * routes a patched GET through a WebView request to its local interceptor, which
 * hands the native answer back as an android.webkit.WebResourceResponse, and
 * that class throws on any 3xx status. A 304 would reach JS as a failed fetch,
 * so every unchanged poll would read as "Can't reach JagHelm". The plugin call
 * returns status, headers and body over the bridge, so a 304 arrives intact.
 * Everything else (unconditional GETs, writes, the app's own files) keeps
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

/** Route conditional GETs through the native plugin. Idempotent; a no-op in a browser. */
export function installNativeHttp() {
  if (!isNativeHttp() || window.fetch[WRAPPED]) return;
  const baseFetch = window.fetch;
  const fetchWithConditionalGets = (resource, options) =>
    isConditionalBackendGet(resource, options)
      ? nativeConditionalGet(String(resource), options)
      : baseFetch(resource, options);
  fetchWithConditionalGets[WRAPPED] = true;
  window.fetch = fetchWithConditionalGets;
}

function isConditionalBackendGet(resource, options) {
  // apiFetch passes a URL string; anything else keeps the normal path.
  if (typeof resource !== 'string' && !(resource instanceof URL)) return false;
  if ((options?.method || 'GET').toUpperCase() !== 'GET') return false;
  if (!new Headers(options?.headers).has('If-None-Match')) return false;
  try {
    const url = new URL(String(resource), window.location.href);
    return /^https?:$/.test(url.protocol) && url.origin !== window.location.origin;
  } catch {
    return false;
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

// Same body handling as Capacitor's own patch: the plugin parses a JSON body, so
// it is serialized back; any other body arrives as text.
function toResponse({ status, headers = {}, data }) {
  if (NULL_BODY_STATUSES.has(status)) return new Response(null, { status, headers });
  const json = (new Headers(headers).get('Content-Type') || '').includes('application/json');
  const body = json ? JSON.stringify(data) : data == null ? '' : String(data);
  return new Response(body, { status, headers });
}
