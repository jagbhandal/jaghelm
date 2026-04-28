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

export function apiError(res, status, publicMessage, err = null) {
  if (err) {
    const detail = err.message || String(err);
    console.error(`[api] ${status} ${publicMessage}: ${detail}`);
  }
  return res.status(status).json({ error: publicMessage });
}
