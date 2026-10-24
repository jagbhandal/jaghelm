/**
 * Structured access log: one JSON line per request, written on response
 * 'finish'. Mounted first in index.js so it brackets the whole pipeline.
 *
 * Path: req.originalUrl, not req.path. By 'finish', a response sent from inside
 * a mounted router still has req.url/req.path relative to the mount
 * ("/gitea/activity" for GET /api/gitea/activity), so req.path would drop the
 * /api prefix (#245). The query string and fragment are dropped: any client
 * can put a credential in a query string, so the log keeps the path only. The scheme
 * and authority of an absolute-form request (GET http://user:pass@host/x), which
 * Node accepts and Express routes on its path, are dropped too.
 *
 * Level (#492, accessLevel): the default LOG_LEVEL=info shows what matters, not
 * every dashboard poll. 5xx at error. At info: every 4xx (a 401 or 403 included,
 * so a signed-out tab or an unauthenticated poller still shows), every request
 * of SLOW_REQUEST_MS or more, and every request that can change something: any
 * method but GET, HEAD and OPTIONS, which covers config saves, cron reports and
 * sign-ins. A fast successful read (a poll's 200 or 304) is debug, so
 * LOG_LEVEL=debug shows every request. The scrape and probe endpoints
 * (Prometheus, the Docker HEALTHCHECK and the deploy gate hit them on a timer)
 * are logged only when they fail: a wedged refresh loop turns /api/health into
 * a 503, and that must still leave a line.
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

// Methods that only read. Express answers HEAD with the GET route, and OPTIONS
// is the CORS preflight a cross-origin poll sends first; any other method can
// change something.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The level a finished request logs at, or null for no line (a healthy probe).
 * See "Level" above.
 */
export function accessLevel(req, res, ms, slowMs = SLOW_REQUEST_MS) {
  const status = res.statusCode;
  if (status >= 500) return 'error';
  if (PROBE_PATHS.has(requestPath(req))) return null;
  if (status >= 400 || ms >= slowMs) return 'info';
  if (!READ_METHODS.has(req.method)) return 'info';
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
      const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
      const level = accessLevel(req, res, ms, slowMs);
      if (!level) return;
      const fields = { method: req.method, path: requestPath(req), status: res.statusCode, ms };
      logger[level](fields, 'request');
    });
    next();
  };
}
