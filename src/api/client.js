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

// Hook called when an /api call outside /api/auth/ returns 401: the session
// expired or was revoked (JagHelm sessions are 24h and die on server restart),
// or a tab sent no token to a server that now has a password. Both shells
// register one (web: App.jsx, #492; mobile: mobile/src/App.jsx). It gets the
// token the request was sent with ('' for none) and may return a promise.
// Once per token: while it runs, other 401s don't call it again; once it
// resolves, the token is done. A rejection is logged, and the next 401 retries
// it once.
let onAuthExpired = null;
// The report state of the current token; setAuthToken starts a new one.
let expiry = { running: false, done: false, failures: 0 };

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
  expiry = { running: false, done: false, failures: 0 };
}

/**
 * Update the in-memory auth token. Token persistence routes through secureStore
 * (web: localStorage via the default adapter; mobile: Keystore later); this only
 * updates the in-memory value apiFetch reads. Pass '' to clear it (logout).
 */
export function setAuthToken(token) {
  authToken = token || '';
  expiry = { running: false, done: false, failures: 0 };
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

/** Tell the shell a request sent with `sent` got a 401: see onAuthExpired. */
function reportExpired(sent) {
  const state = expiry;
  if (!onAuthExpired || sent !== authToken || state.running || state.done) return;
  if (state.failures > 1) return; // the first attempt and its one retry failed
  state.running = true;
  const settle = (failed, err) => {
    state.running = false;
    if (!failed) state.done = true;
    else {
      state.failures += 1;
      console.warn('[auth] the expired-session handler failed:', err);
    }
  };
  try {
    Promise.resolve(onAuthExpired(sent)).then(
      () => settle(false),
      (err) => settle(true, err)
    );
  } catch (err) {
    settle(true, err);
  }
}

/** How long a sign-out waits for the server to revoke the session (#507). */
export const SIGN_OUT_TIMEOUT_MS = 5000;

/**
 * Revoke a session on the server: POST /api/auth/logout with `token` (default:
 * the in-memory one; nothing is sent without one). The request goes out within
 * the call, with the token and base of that moment, so both apps call it on the
 * user's sign-out and then clear the session locally without waiting for it. It
 * never rejects and gives up after SIGN_OUT_TIMEOUT_MS: a network error, a hang
 * or a 5xx can't keep anyone signed in. Only its status is read. It goes through
 * window.fetch, not apiFetch, so the token is the one passed and a 401 (a
 * server older than the route, with a dead token) is not an expired session.
 * The 401 self-heal doesn't call it: that session is already dead.
 *
 * It answers whether the server answered (below 500: revoked, or a token or
 * route it doesn't know, so nothing is left to do) or there was no token. The
 * Android app keeps a revoke that answered false and sends it again later, to
 * `base`, the server that session belongs to (#539).
 */
export async function revokeSession(token = authToken, { base = getApiBase() } = {}) {
  if (!token) return true;
  const controller = new AbortController();
  let timer;
  let reached = false;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve();
    }, SIGN_OUT_TIMEOUT_MS);
  });
  const request = (async () => {
    try {
      const r = await window.fetch(`${base}/auth/logout`, {
        method: 'POST',
        headers: { 'x-auth-token': token },
        signal: controller.signal,
      });
      reached = !!r && r.status < 500;
    } catch {
      // Offline, refused or aborted: the caller signs out locally all the same.
    }
  })();
  await Promise.race([request, deadline]);
  clearTimeout(timer);
  return reached;
}

/**
 * fetch wrapper for /api calls. If `url` starts with the configured API base
 * (getApiBase()), is not the login route, and a token is set, `x-auth-token` is
 * merged into a *new* options object (the caller's opts/headers are never
 * mutated). A 401 from an /api call outside /api/auth/ goes to the auth-expired
 * hook, whether or not it carried a token; a 401 from /api/auth/ is about the
 * password sent (a wrong password at sign-in, or a wrong current password on
 * change-password), not the session. Anything else passes through unchanged.
 * Web base is '/api' (same-origin). Mobile base is an absolute Tailscale URL
 * so absolute calls also get the header.
 */
export function apiFetch(url, opts) {
  // Base-aware: matches '/api' on web OR 'http://host/api' on mobile, so the
  // protected-route guard injects x-auth-token regardless of transport origin.
  const base = getApiBase();
  if (typeof url !== 'string' || !url.startsWith(base)) return window.fetch(url, opts);
  const sent = authToken;
  const request =
    sent && !url.includes('/auth/login')
      ? window.fetch(url, {
          ...(opts || {}),
          headers: { ...(opts && opts.headers), 'x-auth-token': sent },
        })
      : window.fetch(url, opts);
  if (url.slice(base.length).startsWith('/auth/')) return request;
  return request.then((r) => {
    if (r && r.status === 401) reportExpired(sent);
    return r;
  });
}
