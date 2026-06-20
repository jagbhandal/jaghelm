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

/**
 * Fail-closed gate for sensitive endpoints (the standalone secrets API).
 *
 * When no password is configured, authMiddleware lets every request through —
 * which would expose the raw secrets API (enumerate key names, overwrite/delete
 * stored credentials) to anyone who can reach the port. This refuses to serve
 * those routes until auth is enabled. It does NOT affect the integration-save
 * flow (that has its own route), so a no-auth homelab can still be configured.
 *
 * Escape hatch for users who deliberately want the old open behavior on a
 * trusted, isolated LAN: JAGHELM_ALLOW_OPEN_SECRETS=true.
 */
export function requireAuthEnabled(req, res, next) {
  if (authEnabled()) return next();
  if (String(process.env.JAGHELM_ALLOW_OPEN_SECRETS || '').toLowerCase() === 'true') {
    return next();
  }
  return apiError(
    res,
    403,
    'Disabled until a dashboard password is set (DASH_PASS or the password setup). Set JAGHELM_ALLOW_OPEN_SECRETS=true to override on a trusted LAN.'
  );
}

/**
 * Fail-closed gate for the raw infrastructure passthroughs (PromQL query, the
 * Docker-socket container list, AdGuard/NPM/Uptime stats). In no-auth mode
 * authMiddleware lets everyone through, which would hand an unauthenticated LAN
 * peer a raw query interface into the whole homelab (and the Docker socket).
 * Aggregated/benign routes (/history, /ups, /gitea/activity) stay open.
 *
 * Escape hatch for a deliberately-open trusted LAN: JAGHELM_ALLOW_OPEN_INFRA=true.
 */
export function requireAuthEnabledInfra(req, res, next) {
  if (authEnabled()) return next();
  if (String(process.env.JAGHELM_ALLOW_OPEN_INFRA || '').toLowerCase() === 'true') {
    return next();
  }
  return apiError(
    res,
    403,
    'Disabled until a dashboard password is set. Set JAGHELM_ALLOW_OPEN_INFRA=true to override on a trusted LAN.'
  );
}