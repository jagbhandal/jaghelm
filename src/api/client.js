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
 * is a '/api' string that isn't the login route and a token is set, `x-auth-token`
 * is merged into a *new* options object (the caller's opts/headers are never
 * mutated); otherwise the call passes through unchanged.
 */
export function apiFetch(url, opts = {}) {
  if (
    typeof url === 'string' &&
    url.startsWith('/api') &&
    !url.includes('/auth/login') &&
    authToken
  ) {
    return window.fetch(url, {
      ...opts,
      headers: { ...opts.headers, 'x-auth-token': authToken },
    });
  }
  return window.fetch(url, opts);
}
