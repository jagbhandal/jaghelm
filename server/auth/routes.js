/**
 * Auth routes — login, sign-out, status check, password change.
 *
 * Mounted at /api/auth from server/index.js:
 *   POST /api/auth/login
 *   POST /api/auth/logout
 *   GET  /api/auth/check
 *   POST /api/auth/change-password
 */

import { Router } from 'express';

import { authMiddleware } from './middleware.js';
import { authEnabled, checkPassword, getAuthUser, safeBufEqual, setPassword } from './passwords.js';
import {
  createSession,
  deleteAllSessionsExcept,
  deleteSession,
  getSession,
  revocationSaved,
} from './sessions.js';
import { loginAttempt, loginFailureDelay } from './rateLimit.js';
import { apiError } from '../errors.js';
import { recordAuthFailure } from '../metrics.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('auth');
const router = Router();

/** Constant-time string compare. Coerces to buffers, then defers to the shared
 *  length-guarded safeBufEqual (see passwords.js for the constant-time rationale). */
function constantTimeEqual(a, b) {
  return safeBufEqual(Buffer.from(String(a)), Buffer.from(String(b)));
}

router.post('/login', async (req, res) => {
  if (!authEnabled()) {
    return res.json({ token: 'noauth', user: 'admin' });
  }

  const { username, password } = req.body || {};
  // Strings only: the compare below coerces, so ["admin"] would pass as admin.
  // Checked first: a request that can't be a guess doesn't count as one.
  if (typeof username !== 'string' || typeof password !== 'string') {
    return apiError(res, 400, 'Username and password are required');
  }

  // Per address and for the account, whatever the user name (rateLimit.js, #257).
  const attempt = loginAttempt(req.ip ?? req.socket?.remoteAddress);
  if (!attempt.ok) {
    const seconds = Math.max(1, Math.ceil(attempt.retryAfterMs / 1000));
    res.set('Retry-After', String(seconds));
    return apiError(res, 429, `Too many login attempts. Try again in ${seconds} seconds.`);
  }
  // Verify both username and password before branching, so a username-mismatch
  // path can't be distinguished from a password-mismatch path by timing. Note
  // that scrypt itself dominates the timing budget, so this matters more as a
  // hygiene measure than as a defence against remote timing attacks over WAN.
  const userOk = constantTimeEqual(username, getAuthUser());
  const passOk = checkPassword(password);

  if (userOk && passOk) {
    attempt.succeeded(); // clears this address; it may skip the account bucket next time
    const token = createSession(username);
    return res.json({ token, user: username });
  }

  // The attempt was counted as a failure when it was let through.
  recordAuthFailure(); // metric
  await loginFailureDelay(); // throttle + dull the timing oracle
  return apiError(res, 401, 'Invalid credentials');
});

/**
 * Sign out (#507): delete the presented token's session, and only that one.
 * The deletion, written to sessions.json before the answer (#250), is the
 * revocation: the token gets a 401 on every protected route from now on, also
 * after a restart. A deletion the disk can't take (sessions.json can be neither
 * written nor removed) answers 503, not success: a restart would bring the
 * session back, so the client sends the sign-out again (Android keeps it,
 * #539), and each one tries the write again. Otherwise idempotent and quiet:
 * an unknown, expired or already revoked token, or none, gets the same 204, so
 * a second sign-out or another tab never meets a 401 (which the clients read as
 * an expired session), and the answer tells nothing about a token. Only a real
 * sign-out logs, with the user and never the token.
 */
router.post('/logout', (req, res) => {
  if (!authEnabled()) return res.status(204).end();
  const token = req.headers['x-auth-token'];
  const session = getSession(token);
  deleteSession(token); // also writes again a sign-out of this token the disk refused
  if (session) log.info({ user: session.user }, 'signed out');
  if (!revocationSaved(token)) {
    return apiError(res, 503, 'Signed out, but the sign-out could not be saved. Try again.');
  }
  return res.status(204).end();
});

router.get('/check', (req, res) => {
  if (!authEnabled()) {
    return res.json({ authenticated: true, authRequired: false });
  }

  const token = req.headers['x-auth-token'];
  if (token && getSession(token)) {
    return res.json({ authenticated: true, authRequired: true, user: getAuthUser() });
  }

  return res.json({ authenticated: false, authRequired: true });
});

router.post('/change-password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return apiError(res, 400, 'Missing current or new password');
  }
  if (newPassword.length < 6) {
    return apiError(res, 400, 'New password must be at least 6 characters');
  }
  if (!checkPassword(currentPassword)) {
    return apiError(res, 401, 'Current password is incorrect');
  }

  try {
    setPassword(newPassword);
    // Even if sessions.json can't take this, it holds: its credential stamp is
    // for the old password, so a restart starts with no sessions (#250).
    deleteAllSessionsExcept(req.headers['x-auth-token']);
    log.info('password changed');
    return res.json({ ok: true });
  } catch (err) {
    return apiError(res, 500, 'Failed to save new password', err);
  }
});

export { router as authRoutes };
