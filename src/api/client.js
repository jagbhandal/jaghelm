/**
 * API client — explicit auth-injecting fetch wrapper.
 *
 * Replaces the old global `window.fetch` monkeypatch (formerly in App.jsx).
 * Rather than patching the platform fetch, callers import `apiFetch` and use it
 * exactly like `fetch`. For same-origin `/api` requests (except the login route)
 * it attaches the `x-auth-token` header when a token is set; everything else —
 * including external URLs — passes straight through to the real `window.fetch`.
 *
 * The token lives in a module-level variable. `localStorage('jaghelm-token')` is
 * the source of truth across reloads: the module seeds itself from it at load,
 * and App writes localStorage on login/logout, then calls `setAuthToken()` to
 * keep this in-memory copy in sync within the live session.
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

/** Return the current in-memory auth token (''. if none). */
export function getAuthToken() {
  return authToken;
}

/**
 * fetch wrapper that injects the auth header for protected /api calls.
 *
 * Behaviourally identical to the previous interceptor: if `url` is a string
 * starting with '/api', is not the login route, and a token is set, the
 * `x-auth-token` header is merged into a *new* options object (the caller's
 * opts/headers are never mutated). Otherwise the call passes through unchanged.
 *
 * Always calls the real `window.fetch` — this module never patches it.
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
