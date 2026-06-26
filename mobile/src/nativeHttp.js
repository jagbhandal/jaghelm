/**
 * Default transport = Capacitor native HTTP. With `CapacitorHttp.enabled: true`
 * in capacitor.config.ts, Capacitor patches window.fetch at native runtime so
 * apiFetch leaves the WebView (bypassing CORS, reading ETag for 304s). There is
 * no JS API to enable it — this module asserts/markers the decision and is the
 * single seam where a WebView-fetch fallback toggle would live.
 */
let installed = false;

export function installNativeHttp() {
  // Idempotent marker. Native patching happens in the bridge; nothing to wire in
  // JS today. Kept explicit so the default-transport decision is testable.
  installed = true;
}

/** True when Capacitor's native HTTP bridge is present at runtime. */
export function isNativeHttp() {
  return typeof window !== 'undefined' && !!window.CapacitorHttp;
}

/** Test/diagnostic helper: whether installNativeHttp() has run this session. */
export function _isInstalled() {
  return installed;
}
