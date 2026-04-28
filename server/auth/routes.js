/**
 * Auth routes — login, status check, password change.
 *
 * Mounted at /api/auth from server/index.js:
 *   POST /api/auth/login
 *   GET  /api/auth/check
 *   POST /api/auth/change-password
 */

import { Router } from 'express';

import { authMiddleware } from './middleware.js';
import { authEnabled, checkPassword, getAuthUser, setPassword } from './passwords.js';
import { createSession, deleteAllSessionsExcept, getSession } from './sessions.js';
import { checkLoginRate, resetLoginRate } from './rateLimit.js';
import { apiError } from '../errors.js';

const router = Router();

router.post('/login', (req, res) => {
  if (!authEnabled()) {
    return res.json({ token: 'noauth', user: 'admin' });
  }

  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (!checkLoginRate(ip)) {
    return apiError(res, 429, 'Too many login attempts. Try again in 15 minutes.');
  }

  const { username, password } = req.body || {};
  if (username === getAuthUser() && checkPassword(password)) {
    resetLoginRate(ip);
    const token = createSession(username);
    return res.json({ token, user: username });
  }

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
    console.log('[auth] Password changed successfully');
    return res.json({ ok: true });
  } catch (err) {
    return apiError(res, 500, 'Failed to save new password', err);
  }
});

export { router as authRoutes };
