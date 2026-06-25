/**
 * Single source of truth for the API base URL.
 *
 * Web (desktop) uses a relative same-origin '/api' and never calls setApiBase,
 * so getApiBase() returns '/api' and behaviour is byte-for-byte as before.
 * Mobile (a later phase) reads a stored absolute Tailscale URL from secure
 * storage at boot and calls setApiBase() BEFORE any data hook fires.
 *
 * A build may pre-seed an absolute base via VITE_JAGHELM_BASE_URL; the desktop
 * build sets no such var, so the default '/api' holds.
 */
let apiBase =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_JAGHELM_BASE_URL) || '/api';

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
