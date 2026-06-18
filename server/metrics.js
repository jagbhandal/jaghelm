/**
 * Prometheus metrics — "monitor the monitor".
 *
 * Metric names match docs/slos/* exactly so the documented SLO queries resolve
 * against a real scrape target:
 *   http_requests_total{route,method,code}                  → feed-success-rate
 *   http_request_duration_seconds_bucket{route,method,le}   → feed-latency (needs le=0.3)
 *   jaghelm_cache_age_seconds{cache="services"}             → data-freshness
 * plus refresh-loop health and auth-failure counters. Exposed at GET /metrics.
 */
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

import { getCacheAgeMs } from './cache.js';

export const register = new Registry();
register.setDefaultLabels({ app: 'jaghelm' });
// Node/process metrics (event-loop lag, heap, GC, fds) — free, standard.
collectDefaultMetrics({ register });

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests by route pattern, method, and status code.',
  labelNames: ['route', 'method', 'code'],
  registers: [register],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds by route pattern and method.',
  labelNames: ['route', 'method'],
  // 0.3 is present so the feed-latency SLO (le="0.3") has a real bucket edge.
  buckets: [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

// Cache freshness, computed on scrape so it's always current (no background timer).
new Gauge({
  name: 'jaghelm_cache_age_seconds',
  help: 'Age in seconds of the named response-cache entry (absent → not reported).',
  labelNames: ['cache'],
  registers: [register],
  collect() {
    const ageMs = getCacheAgeMs('services');
    if (ageMs != null) this.set({ cache: 'services' }, ageMs / 1000);
  },
});

const refreshCycleDuration = new Histogram({
  name: 'jaghelm_refresh_cycle_duration_seconds',
  help: 'Background refresh cycle duration in seconds.',
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

const refreshErrorsTotal = new Counter({
  name: 'jaghelm_refresh_errors_total',
  help: 'Background refresh cycles that ended in an error.',
  registers: [register],
});

const refreshLastSuccess = new Gauge({
  name: 'jaghelm_refresh_last_success_timestamp_seconds',
  help: 'Unix timestamp of the last successfully completed background refresh cycle.',
  registers: [register],
});

const authFailuresTotal = new Counter({
  name: 'jaghelm_auth_failures_total',
  help: 'Failed authentication attempts (wrong password / invalid session).',
  registers: [register],
});

/** Record one background refresh cycle. */
export function recordRefreshCycle(durationMs, ok) {
  refreshCycleDuration.observe(durationMs / 1000);
  if (ok) refreshLastSuccess.setToCurrentTime();
  else refreshErrorsTotal.inc();
}

/** Record one failed authentication attempt. */
export function recordAuthFailure() {
  authFailuresTotal.inc();
}

/**
 * Label a request by its matched route PATTERN (e.g. /api/integrations/:type),
 * not the raw URL — keeps label cardinality bounded. Static assets that bypass
 * routing collapse to a single 'static_or_unmatched' bucket; the SPA/API
 * catch-alls (app.get('*'), /api/*) label as their wildcard pattern — also
 * bounded. req.route is populated by the time res 'finish' fires, when we read it.
 */
function normalizeRoute(req) {
  if (req.route) {
    return ((req.baseUrl || '') + (req.route.path || '')).replace(/\/+$/, '') || '/';
  }
  return 'static_or_unmatched';
}

/** Express middleware: count + time every request on response 'finish'. */
export function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = normalizeRoute(req);
    const method = req.method;
    httpRequestsTotal.inc({ route, method, code: String(res.statusCode) });
    httpRequestDuration.observe({ route, method }, Number(process.hrtime.bigint() - start) / 1e9);
  });
  next();
}

/** GET /metrics handler — Prometheus exposition format. */
export async function metricsHandler(req, res) {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
}
