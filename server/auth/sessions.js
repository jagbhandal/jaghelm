/**
 * In-memory session store.
 *
 * Sessions live for 24 hours. A background sweep removes expired entries
 * once an hour so the Map doesn't grow unbounded over long uptimes.
 *
 * Sessions are keyed by an opaque random token (32 bytes hex) generated at
 * login. Token storage and transport (header vs. localStorage) is the
 * caller's concern.
 */

import crypto from 'crypto';

export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const sessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of sessions) {
    if (now - entry.created > SESSION_MAX_AGE_MS) {
      sessions.delete(token);
    }
  }
}, CLEANUP_INTERVAL_MS);

/** Create a new session for `user` and return the token. */
export function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user, created: Date.now() });
  return token;
}

/**
 * Look up an active session by token. Returns the session entry or null.
 * Expired sessions are deleted on lookup.
 */
export function getSession(token) {
  if (!token) return null;
  const entry = sessions.get(token);
  if (!entry) return null;
  if (Date.now() - entry.created >= SESSION_MAX_AGE_MS) {
    sessions.delete(token);
    return null;
  }
  return entry;
}

/** Delete a single session by token. Returns true if anything was removed. */
export function deleteSession(token) {
  return sessions.delete(token);
}

/**
 * Invalidate every session except `keepToken` (typically the caller's own).
 * Used after a password change to force re-auth on other devices.
 */
export function deleteAllSessionsExcept(keepToken) {
  for (const token of sessions.keys()) {
    if (token !== keepToken) sessions.delete(token);
  }
}