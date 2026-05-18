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

// TODO(jaghelm): server/index.js is missing a 4-arg Express error-handler
// middleware. Async route handlers wrapped with util/asyncHandler.js forward
// rejections to `next(err)`, which Express then routes to its built-in
// finalhandler — that responds with an HTML 500 page, not the JSON shape the
// dashboard expects. Add this to index.js (right before the SPA fallback):
//
//   app.use((err, req, res, _next) => apiError(res, 500, err.message || 'Internal error', err));
//
// Owned by another agent; do not edit index.js from this slice.
