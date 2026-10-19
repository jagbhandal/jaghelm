/**
 * Structured access log: one JSON line per request, written on response
 * 'finish'. Mounted first in index.js so it brackets the whole pipeline.
 *
 * Path: req.originalUrl, not req.path. By 'finish', a response sent from inside
 * a mounted router still has req.url/req.path relative to the mount
 * ("/gitea/activity" for GET /api/gitea/activity), so req.path would drop the
 * /api prefix (#245). The query string and fragment are dropped: GET
 * /api/push/prefs carries the device's FCM token in ?token=, and any client can
 * put a credential in a query string, so the log keeps the path only. The scheme
 * and authority of an absolute-form request (GET http://user:pass@host/x), which
 * Node accepts and Express routes on its path, are dropped too.
 *
 * Level: 5xx at error, 4xx and slow requests at info, the rest at debug, so the
 * default LOG_LEVEL=info shows what went wrong without one line per poll. The
 * scrape and probe endpoints (Prometheus, the Docker HEALTHCHECK and the deploy
 * gate hit them on a timer) are logged only when they fail: a wedged refresh
 * loop turns /api/health into a 503, and that must still leave a line.
 */
import { createLogger } from './util/logger.js';

// Same 300 ms line as the feed-latency SLO (docs/slos/feed-latency.md) and the
// le="0.3" bucket in metrics.js: a request that slow is worth an info line.
export const SLOW_REQUEST_MS = 300;

// Logged only when they answer 5xx.
const PROBE_PATHS = new Set(['/metrics', '/api/health', '/api/readyz']);

// Scheme + authority (userinfo included) of an absolute-form request target.
const ABSOLUTE_FORM = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

/** Full request path (mount prefix included), without query, fragment or authority. */
function requestPath(req) {
  const url = (req.originalUrl || req.url || '').replace(ABSOLUTE_FORM, '');
  return url.split(/[?#]/, 1)[0] || '/';
}

/** Log level for a finished request. */
export function accessLogLevel(status, ms, slowMs = SLOW_REQUEST_MS) {
  if (status >= 500) return 'error';
  if (status >= 400 || ms >= slowMs) return 'info';
  return 'debug';
}

/** Express middleware factory. `logger` and `slowMs` are injectable for tests. */
export function createAccessLog({
  logger = createLogger('jaghelm'),
  slowMs = SLOW_REQUEST_MS,
} = {}) {
  return function accessLog(req, res, next) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const path = requestPath(req);
      if (PROBE_PATHS.has(path) && res.statusCode < 500) return;
      const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
      const fields = { method: req.method, path, status: res.statusCode, ms };
      logger[accessLogLevel(res.statusCode, ms, slowMs)](fields, 'request');
    });
    next();
  };
}
