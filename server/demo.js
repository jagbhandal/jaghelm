/**
 * Read-only public demo mode (DEMO_MODE=true).
 *
 * Security model — this is a new public, unauthenticated ingress, so it is
 * locked down by construction (see docs/security/STRIDE.md):
 *   - EVERY state-changing request (POST/PUT/DELETE/PATCH) is refused 403.
 *   - The middleware OWNS the entire /api surface: reads are answered from the
 *     demo's fixtures (demoFixtures.js) or an empty default, and the request
 *     never reaches a real route — so there is NO outbound fetch, NO backend
 *     dependency, and NO secrets endpoint reachable.
 *   - An icon the board asks /api/icons/cached for is a redirect to the icon
 *     repository's URL, which the browser loads itself; the server neither
 *     fetches nor stores it. Only the URLs the live cache would fetch
 *     (icon-sources.js) are redirected, so it is no open redirect.
 *   - boot() in index.js starts none of the subsystems in demo mode: no
 *     discovery, refresh loop, Kuma, push, Arcane, icon cache or services.yaml,
 *     so the server makes no outbound request and writes no file (#248). The
 *     browser still loads the board's icons from the icon CDN (above).
 *   - /metrics is at the root (not /api) and is unaffected.
 *
 * Mounted FIRST on /api in server/index.js when isDemoMode() is true, ahead of
 * auth + the real routers.
 */
import { createLogger } from './util/logger.js';
import { canonicalIconUrl } from './icon-sources.js';
import { listPresets } from './integrations/registry.js';
import { VERSION } from './version.js';
import {
  DEMO_SCENARIOS,
  demoServices,
  demoServicesConfig,
  demoMonitorNames,
  demoHistory,
  demoUps,
  demoGiteaActivity,
  demoCronStatus,
  demoDisplayConfig,
  demoTodos,
} from './demoFixtures.js';

const log = createLogger('demo');

export function isDemoMode() {
  return process.env.DEMO_MODE === 'true';
}

/** The fixture set DEMO_SCENARIO picks: `incident` (the default) or `healthy`. */
export function demoScenario(env = process.env) {
  return DEMO_SCENARIOS.includes(env.DEMO_SCENARIO) ? env.DEMO_SCENARIO : 'incident';
}

const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// Exact-path reads. Anything else under /api answers an empty object (no route runs).
const READS = {
  '/api/health': () => ({ status: 'ok', demo: true, version: VERSION }),
  '/api/readyz': () => ({ ready: true, demo: true, checks: { prometheus: true, kuma: true } }),
  '/api/auth/check': () => ({ authenticated: true, authRequired: false, demo: true }),
  '/api/display-config': demoDisplayConfig,
  '/api/services': demoServices,
  '/api/services/config': demoServicesConfig,
  '/api/services/monitors': demoMonitorNames,
  '/api/history': demoHistory,
  '/api/ups': demoUps,
  '/api/gitea/activity': demoGiteaActivity,
  '/api/cron': () => [],
  '/api/cron/status': demoCronStatus,
  '/api/integrations': () => ({}),
  // The preset gallery is code in the image, not live data (empty unless
  // boot() loaded the registry).
  '/api/integrations/presets': () => listPresets(),
  '/api/todos': demoTodos,
};

/**
 * The demo's answer to one /api request: `{ status, body }`, or `{ status,
 * location }` for a redirect. `path` is the full path ("/api/services"); a
 * trailing slash is ignored. Pure apart from the clock: the Express middleware
 * below and the web client's demo render test both answer through it.
 *
 * @param {{ method?: string, path: string, query?: Record<string, unknown>, scenario?: string, now?: number }} req
 */
export function demoResponse({
  method = 'GET',
  path,
  query = {},
  scenario = demoScenario(),
  now = Date.now(),
}) {
  // 1. Refuse every state-changing request.
  if (MUTATING.has(method)) return { status: 403, body: { error: 'This is a read-only demo' } };
  // Express does NOT strip a trailing slash, so "/api/services/" would miss the
  // table and fall through to {}. Drop it (except on the root path itself).
  const p = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  // 2. Icons: the browser fetches them from the icon repository itself.
  if (p === '/api/icons/cached') {
    const url = canonicalIconUrl(query.url);
    return url
      ? { status: 302, location: url }
      : { status: 404, body: { error: 'Not a cached icon' } };
  }
  // 3. Reads: a fixture, else an empty object. Never a real route.
  if (Object.hasOwn(READS, p)) return { status: 200, body: READS[p]({ scenario, now }) };
  return { status: 200, body: {} };
}

export function demoMiddleware(req, res) {
  // Never calls next() for /api, so no real route runs → no outbound, no
  // secrets, no backend needed. Mounted at /api, so req.path is mount-relative:
  // reconstruct the full path.
  const out = demoResponse({ method: req.method, path: req.baseUrl + req.path, query: req.query });
  if (out.location) {
    res.set('Cache-Control', 'public, max-age=86400');
    return res.redirect(out.status, out.location);
  }
  return res.status(out.status).json(out.body);
}

export function logDemoBanner(port) {
  log.warn(
    { port, scenario: demoScenario() },
    'DEMO_MODE is ON — /api is read-only and self-contained (no writes, no secrets, no outbound). Do NOT use for a real dashboard.'
  );
}
