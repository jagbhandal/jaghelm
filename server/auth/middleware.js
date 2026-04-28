/**
 * Express middleware that enforces an active session on protected routes.
 *
 * Token is read from the `x-auth-token` header or the `?token=` query
 * parameter. When auth is disabled (no password configured), every request
 * is allowed through. Mount per-route or as `app.use('/api/...', authMiddleware)`.
 */

import { authEnabled } from './passwords.js';
import { getSession } from './sessions.js';
import { apiError } from '../errors.js';

export function authMiddleware(req, res, next) {
  if (!authEnabled()) return next();

  const token = req.headers['x-auth-token'] || req.query.token;
  if (token && getSession(token)) return next();

  return apiError(res, 401, 'Unauthorized');
}
