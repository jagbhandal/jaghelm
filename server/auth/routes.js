/**
 * Auth routes — login, status check, password change.
 *
 * Mounted at /api/auth from server/index.js:
 *   POST /api/auth/login
 *   GET  /api/auth/check
 *   POST /api/auth/change-password
 */

import crypto from 'crypto';
import { Router } from 'express';

import { authMiddleware } from './middleware.js';
import { authEnabled, checkPassword, getAuthUser, setPassword } from './passwords.js';
import { createSession, deleteAllSessionsExcept, getSession } from './sessions.js';
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

/**
 * Constant-time string compare that doesn't leak length information by
 * short-circuiting. Equal-length buffers are compared via timingSafeEqual;
 * unequal-length inputs still run the compare (against a same-length dummy)
 * before returning false, so the call duration is independent of where the
 * mismatch is.
 */
function constantTimeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Run a dummy compare so timing stays roughly flat across the
    // length-mismatch and equal-length-mismatch cases.
    crypto.timingSafeEqual(ab, Buffer.alloc(ab.length));
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
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
