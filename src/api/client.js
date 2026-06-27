/**
 * API client — explicit auth-injecting fetch wrapper. Callers import `apiFetch`
 * and use it like `fetch`; for same-origin `/api` requests (except the login
 * route) it attaches `x-auth-token` when a token is set, everything else passes
 * straight through to the real `window.fetch`.
 *
 * Source of truth for the token across reloads is secureStore('jaghelm-token'):
 * initAuthToken() seeds it at boot; App writes it on login/logout then calls
 * setAuthToken() to keep the in-memory copy in sync within the live session.
 * Web adapter = localStorage (byte-for-byte unchanged); mobile = Keystore later.
 */

import { getApiBase } from './baseUrl.js';
import { secureStore } from '../storage/index.js';

// In-memory token. Previously seeded synchronously from localStorage at module
// load; that seed is now an explicit awaited boot step (initAuthToken) so the
// token source is swappable (web localStorage default; mobile Keystore later).
let authToken = '';

// Optional hook fired when a protected /api call returns 401 (token expired or
// revoked — JagHelm sessions are 24h and die on server restart). Null by default,
// so the web path is byte-for-byte unchanged; the mobile shell registers a
// handler that clears the token and routes back to the login screen. Must be
// idempotent: several in-flight requests can each 401 in the same window.
let onAuthExpired = null;

/** Register (or clear, with null) the 401 auth-expired handler. */
export function setAuthExpiredHandler(fn) {
  onAuthExpired = typeof fn === 'function' ? fn : null;
}

/**
 * Seed the in-memory token from secure storage. Awaited at boot BEFORE any data
 * hook fires, so a reload (web) or app start (mobile) keeps the session. Web
 * reads localStorage via the default adapter — same persisted-session behaviour
 * as the old module-load seed.
 */
export async function initAuthToken() {
  authToken = (await secureStore.getItem('jaghelm-token')) || '';
}

/**
 * Update the in-memory auth token. Token persistence routes through secureStore
 * (web: localStorage via the default adapter; mobile: Keystore later); this only
 * updates the in-memory value apiFetch reads. Pass '' to clear it (logout).
 */
export function setAuthToken(token) {
  authToken = token || '';
}

/** Return the current in-memory auth token ('' if none). */
export function getAuthToken() {
  return authToken;
}

/**
 * fetch wrapper that injects the auth header for protected /api calls. If `url`
 * starts with the configured API base (getApiBase()), is not the login route,
 * and a token is set, `x-auth-token` is merged into a *new* options object (the
 * caller's opts/headers are never mutated); otherwise the call passes through
 * unchanged. Web base is '/api' (same-origin, byte-for-byte unchanged). Mobile
 * base is an absolute Tailscale URL so absolute calls also get the header.
 */
export function apiFetch(url, opts) {
  // Base-aware: matches '/api' on web OR 'http://host/api' on mobile, so the
  // protected-route guard injects x-auth-token regardless of transport origin.
  const base = getApiBase();
  if (
    typeof url === 'string' &&
    url.startsWith(base) &&
    !url.includes('/auth/login') &&
    authToken
  ) {
    return window
      .fetch(url, {
        ...(opts || {}),
        headers: { ...(opts && opts.headers), 'x-auth-token': authToken },
      })
      .then((r) => {
        // Self-heal on an expired/revoked session: notify the shell, but never
        // let a throwing handler break the caller's fetch result.
        if (r && r.status === 401 && onAuthExpired) {
          try {
            onAuthExpired();
          } catch {
            /* handler errors are non-fatal to the request */
          }
        }
        return r;
      });
  }
  return window.fetch(url, opts);
}
