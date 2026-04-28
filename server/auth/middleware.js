/**
 * Express middleware that enforces an active session on protected routes.
 *
 * Token is read from the `x-auth-token` header. Query-string tokens (?token=)
 * are not accepted: URLs are logged by reverse proxies (NPM access logs),
 * upstream DNS resolvers (AdGuard query logs), browser history, and HTTP
 * Referer headers — leaking session tokens into all of those sinks. The
 * frontend exclusively uses the header path, so this has no UX cost.
 *
 * When auth is disabled (no password configured), every request is allowed
 * through. Mount per-route or as `app.use('/api/...', authMiddleware)`.
 */

import { authEnabled } from './passwords.js';
import { getSession } from './sessions.js';
import { apiError } from '../errors.js';

export function authMiddleware(req, res, next) {
  if (!authEnabled()) return next();

  const token = req.headers['x-auth-token'];
  if (token && getSession(token)) return next();

  return apiError(res, 401, 'Unauthorized');
}