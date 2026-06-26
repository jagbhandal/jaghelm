/**
 * Default transport = Capacitor native HTTP. With `CapacitorHttp.enabled: true`
 * in capacitor.config.ts, Capacitor patches window.fetch at native runtime so
 * apiFetch leaves the WebView (bypassing CORS, reading ETag for 304s). There is
 * no JS API to enable it — this module asserts/markers the decision and is the
 * single seam where a WebView-fetch fallback toggle would live.
 */
export function installNativeHttp() {
  // No-op marker. Native HTTP patching is config-driven (CapacitorHttp.enabled in
  // capacitor.config.ts); nothing to wire in JS. Kept explicit so the
  // default-transport decision is grep-able and a future JS toggle has a seam.
}

/** True when Capacitor's native HTTP bridge is present at runtime. */
export function isNativeHttp() {
  return typeof window !== 'undefined' && !!window.CapacitorHttp;
}
