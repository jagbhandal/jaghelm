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
import { createSession, deleteAllSessionsExcept, deleteSession, getSession } from './sessions.js';
import {
  checkLoginRate,
  resetLoginRate,
  registerLoginFailure,
  loginFailureDelay,
} from './rateLimit.js';
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

  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (!checkLoginRate(ip)) {
    return apiError(res, 429, 'Too many login attempts. Try again in 15 minutes.');
  }

  const { username, password } = req.body || {};
  // Verify both username and password before branching, so a username-mismatch
  // path can't be distinguished from a password-mismatch path by timing. Note
  // that scrypt itself dominates the timing budget, so this matters more as a
  // hygiene measure than as a defence against remote timing attacks over WAN.
  const userOk = constantTimeEqual(username || '', getAuthUser());
  const passOk = checkPassword(password || '');

  if (userOk && passOk) {
    resetLoginRate(ip);
    const token = createSession(username);
    return res.json({ token, user: username });
  }

  registerLoginFailure(); // feeds the global brute-force counter
  recordAuthFailure(); // metric
  await loginFailureDelay(); // throttle + dull the timing oracle
  return apiError(res, 401, 'Invalid credentials');
});

/**
 * Sign out (#507): delete the presented token's session, and only that one.
 * Sessions live in memory (ADR 0002), so the deletion is the revocation: the
 * token gets a 401 on every protected route from now on. Idempotent and quiet:
 * an unknown, expired or already revoked token, or none, gets the same 204, so
 * a second sign-out or another tab never meets a 401 (which the clients read as
 * an expired session), and the answer tells nothing about a token. Only a real
 * sign-out logs, with the user and never the token.
 */
router.post('/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  const session = authEnabled() ? getSession(token) : null;
  if (session) {
    deleteSession(token);
    log.info({ user: session.user }, 'signed out');
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
    deleteAllSessionsExcept(req.headers['x-auth-token']);
    log.info('password changed');
    return res.json({ ok: true });
  } catch (err) {
    return apiError(res, 500, 'Failed to save new password', err);
  }
});

export { router as authRoutes };
