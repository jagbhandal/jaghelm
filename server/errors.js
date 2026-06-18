/**
 * Uniform error response helper.
 *
 * Logs the full error server-side (with the route hint) but returns only a
 * generic public message to the client. Use everywhere a route handler would
 * otherwise call `res.status(N).json({ error: ... })`.
 *
 *   apiError(res, 400, 'type required');                  // client error
 *   apiError(res, 502, 'Upstream unreachable', err);      // server error w/ logging
 */

import { redactSecrets } from './util/redact.js';

export function apiError(res, status, publicMessage, err = null) {
  if (err) {
    // Redact: a bubbled-up integration error can carry a URL with ?apikey=…
    const detail = redactSecrets(err.message || String(err));
    console.error(`[api] ${status} ${publicMessage}: ${detail}`);
  }
  return res.status(status).json({ error: publicMessage });
}

/**
 * Express 4-arg error-handler middleware. Async route rejections forwarded via
 * util/asyncHandler.js's next(err) land here and get the JSON error shape the
 * dashboard expects, instead of Express's default HTML 500 page. Register it
 * last in index.js.
 */
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return _next(err);
  return apiError(res, 500, 'Internal server error', err);
}
