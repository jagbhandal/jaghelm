/**
 * API client — explicit auth-injecting fetch wrapper. Callers import `apiFetch`
 * and use it like `fetch`; for same-origin `/api` requests (except the login
 * route) it attaches `x-auth-token` when a token is set, everything else passes
 * straight through to the real `window.fetch`.
 *
 * Source of truth for the token across reloads is localStorage('jaghelm-token'):
 * this module seeds from it at load; App writes it on login/logout then calls
 * setAuthToken() to keep the in-memory copy in sync within the live session.
 */

import { getApiBase } from './baseUrl.js';

// Seed from localStorage at module load so a page reload keeps the session.
let authToken = (typeof localStorage !== 'undefined' && localStorage.getItem('jaghelm-token')) || '';

/**
 * Update the in-memory auth token. App owns localStorage persistence; this only
 * updates the value apiFetch reads. Pass '' to clear it (logout).
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
    return window.fetch(url, {
      ...(opts || {}),
      headers: { ...(opts && opts.headers), 'x-auth-token': authToken },
    });
  }
  return window.fetch(url, opts);
}
