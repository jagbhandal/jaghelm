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

// Hook fired when a protected /api call returns 401 (token expired or revoked:
// JagHelm sessions are 24h and die on server restart). Both shells register
// one that clears the token and shows the sign-in screen (web: App.jsx, #492;
// mobile: mobile/src/App.jsx). It fires once per token: the first 401 marks the
// token reported, so the other polls in flight with it don't fire it again.
let onAuthExpired = null;
let expiryReported = false;

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
  expiryReported = false;
}

/**
 * Update the in-memory auth token. Token persistence routes through secureStore
 * (web: localStorage via the default adapter; mobile: Keystore later); this only
 * updates the in-memory value apiFetch reads. Pass '' to clear it (logout).
 */
export function setAuthToken(token) {
  authToken = token || '';
  expiryReported = false;
}

/** Return the current in-memory auth token ('' if none). */
export function getAuthToken() {
  return authToken;
}

// Whether the server refuses every write: the read-only public demo (#248),
// which says so in /api/auth/check (App sets it). The data helpers then keep a
// change in this tab for the visit instead of sending it (useData.js).
let readOnlyServer = false;

/** Mark the server read-only (true) or writable (false). */
export function setReadOnlyServer(on) {
  readOnlyServer = on === true;
}

/** Whether the server refuses writes, so nothing should be sent to it. */
export function isReadOnlyServer() {
  return readOnlyServer;
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
    const sent = authToken;
    return window
      .fetch(url, {
        ...(opts || {}),
        headers: { ...(opts && opts.headers), 'x-auth-token': sent },
      })
      .then((r) => {
        // Self-heal on an expired/revoked session: notify the shell once per
        // token, and never let a throwing handler break the caller's fetch
        // result. A late 401 for a token since replaced (a new sign-in) is
        // ignored. A 401 from /auth/ is about the password sent (a wrong
        // current password on change-password), not the session.
        if (
          r &&
          r.status === 401 &&
          onAuthExpired &&
          sent === authToken &&
          !expiryReported &&
          !url.slice(base.length).startsWith('/auth/')
        ) {
          expiryReported = true;
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
