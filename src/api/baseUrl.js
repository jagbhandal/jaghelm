/**
 * Single source of truth for the API base URL.
 *
 * Web (desktop) defaults unconditionally to '/api' (same-origin relative) and
 * never calls setApiBase — behaviour is byte-for-byte unchanged.
 * Mobile reads a stored absolute Tailscale URL from secure storage at boot and
 * calls setApiBase() BEFORE any data hook fires.
 */
let apiBase = '/api';

/** Set the API base. Strips trailing slashes; falls back to '/api' if falsy. */
export function setApiBase(base) {
  apiBase = (base || '/api').replace(/\/+$/, '');
}

/** Current API base ('/api' on web by default). */
export function getApiBase() {
  return apiBase;
}

/** True when the base is same-origin relative (starts with '/'). */
export function isRelativeBase() {
  return apiBase.startsWith('/');
}
