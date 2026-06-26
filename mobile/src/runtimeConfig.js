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

/** Validate + canonicalize a backend URL to `<origin>/api`. Throws on bad input. */
export function normalizeBaseUrl(input) {
  const s = String(input || '').trim();
  if (!/^https?:\/\//i.test(s)) throw new Error('invalid url');
  // strip trailing slashes, then a trailing /api (any case), then trailing slashes again
  const stripped = s.replace(/\/+$/, '').replace(/\/api$/i, '').replace(/\/+$/, '');
  if (!/^https?:\/\/.+/i.test(stripped)) throw new Error('invalid url');
  return `${stripped}/api`;
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
    errors.token = 'Enter your access token';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
