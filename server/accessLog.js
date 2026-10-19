/**
 * Structured access log: one JSON line per request, written on response
 * 'finish'. Mounted first in index.js so it brackets the whole pipeline.
 *
 * Path: req.originalUrl, not req.path. By 'finish', a response sent from inside
 * a mounted router still has req.url/req.path relative to the mount
 * ("/gitea/activity" for GET /api/gitea/activity), so req.path would drop the
 * /api prefix (#245). The query string is dropped: GET /api/push/prefs carries
 * the device's FCM token in ?token=, and any client can put a credential in a
 * query string, so the log keeps the path only.
 *
 * Level: 5xx at error, 4xx and slow requests at info, the rest at debug, so the
 * default LOG_LEVEL=info shows what went wrong without one line per poll. The
 * scrape and probe endpoints are not logged at all (Prometheus, the Docker
 * HEALTHCHECK and the deploy gate hit them on a timer).
 */
import { createLogger } from './util/logger.js';

// Same 300 ms line as the feed-latency SLO (docs/slos/feed-latency.md) and the
// le="0.3" bucket in metrics.js: a request that slow is worth an info line.
export const SLOW_REQUEST_MS = 300;

const SKIP_PATHS = new Set(['/metrics', '/api/health', '/api/readyz']);

/** Full request path (mount prefix included), without the query string. */
function requestPath(req) {
  const url = req.originalUrl || req.url || '';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
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
      if (SKIP_PATHS.has(path)) return;
      const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
      const fields = { method: req.method, path, status: res.statusCode, ms };
      logger[accessLogLevel(res.statusCode, ms, slowMs)](fields, 'request');
    });
    next();
  };
}
