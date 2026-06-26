/**
 * Pure runtime-config helpers for the mobile app. No I/O — storage is layered
 * on top by the adapters/boot. The canonical API base always ends in `/api`
 * so apiFetch's `url.startsWith(getApiBase())` guard injects x-auth-token for
 * the absolute mobile URL.
 */
export const BASE_URL_KEY = 'jaghelm-base-url'; // secret → Keystore
export const TOKEN_KEY = 'jaghelm-token'; // secret → Keystore (matches initAuthToken)
export const THEME_KEY = 'jaghelm-theme'; // non-secret → Preferences
export const LAST_TAB_KEY = 'jaghelm-last-tab'; // non-secret → Preferences
export const URL_PRESENT_KEY = 'jaghelm-base-url-present'; // non-secret breadcrumb → Preferences

// Non-secret push state -> @capacitor/preferences (throw-free; NEVER Keystore,
// which would hit the M3a removeItem-throws-on-missing defect). The FCM device
// token is non-secret device state; permission/prefs are UI state.
export const PUSH_TOKEN_KEY = 'jaghelm-push-token'; // FCM device token (for GET/PUT prefs)
export const PUSH_PERM_KEY = 'jaghelm-push-perm'; // 'granted'|'denied'|'prompt' breadcrumb
export const PUSH_PREFS_KEY = 'jaghelm-push-prefs'; // last-known prefs JSON for fast first paint

/** Validate + canonicalize a backend URL to `<origin><path>/api`. Throws on bad input. */
export function normalizeBaseUrl(input) {
  const s = String(input || '').trim();
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error('invalid url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('invalid url');
  // Drop trailing slashes, then a trailing /api segment (any case), so the result
  // is idempotent and a sub-path deployment's own /api is not doubled.
  const path = u.pathname.replace(/\/+$/, '').replace(/\/api$/i, '');
  return `${u.protocol}//${u.host}${path}/api`;
}

/** First-run field validation. Returns { ok, errors } — never throws. */
export function validateFirstRun({ url, token }) {
  const errors = {};
  try {
    normalizeBaseUrl(url);
  } catch {
    errors.url = 'Enter a valid http(s) backend URL';
  }
  if (!String(token || '').trim()) {
    errors.token = 'Enter your access token'; // pragma: allowlist secret -- UI validation message, not a credential
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
