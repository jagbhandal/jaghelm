/**
 * Read-only public demo mode (DEMO_MODE=true).
 *
 * Security model — this is a new public, unauthenticated ingress, so it is
 * locked down by construction (see docs/security/STRIDE.md):
 *   - EVERY state-changing request (POST/PUT/DELETE/PATCH) is refused 403.
 *   - The middleware OWNS the entire /api surface: reads are answered from the
 *     demo's fixtures (demoFixtures.js), and any other path with the live
 *     server's 404 for a path it has no route for (#437). The request never
 *     reaches a real route — so there is NO outbound fetch, NO backend
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
import { envValue } from './env.js';
import { createAlertHistory } from './push/alertHistory.js';
import { readEventsQuery } from './routes/events.js';
import { demoEvents } from './demoEvents.js';
import { TEST_PUSH_COOLDOWN_MS } from './push/testPush.js';
import { DEFAULT_PREFS } from './push/prefs.js';
import { thresholdsOf } from './refresh.js';
import { thresholdView } from './status/thresholdTable.js';
import { DEFAULT_THRESHOLDS } from './status/thresholds.js';
import {
  demoServices,
  demoServicesConfig,
  demoMonitorNames,
  demoMonitorMapping,
  demoDiskForecast,
  demoHistory,
  demoUps,
  demoGiteaActivity,
  demoCronStatus,
  demoDisplayConfig,
  demoIntegrations,
  demoStatus,
  demoTodos,
} from './demoFixtures.js';

const log = createLogger('demo');

export function isDemoMode() {
  return envValue('DEMO_MODE') === true;
}

/**
 * The fixture set DEMO_SCENARIO picks: `incident` (the default) or `healthy`.
 * `env` is the process's environment unless a test passes its own.
 */
export function demoScenario(env) {
  return envValue('DEMO_SCENARIO', env);
}

const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// Exact-path reads. Every read the web and Android apps send is here, or
// answered in demoResponse (the icon redirect, the embed check, the history
// charts, the alert history):
// server/demo.reads.test.js walks their source to keep it so. Any other /api
// path is a 404, and no route runs.
const READS = {
  '/api/health': () => ({ status: 'ok', demo: true, version: VERSION }),
  '/api/readyz': () => ({ ready: true, demo: true, checks: { prometheus: true, kuma: true } }),
  '/api/auth/check': () => ({ authenticated: true, authRequired: false, demo: true }),
  '/api/display-config': demoDisplayConfig,
  // The demo has no setup to guide (#322).
  '/api/setup': () => ({ pending: false }),
  '/api/services': demoServices,
  '/api/services/config': demoServicesConfig,
  '/api/services/monitors': demoMonitorNames,
  '/api/services/monitor-mapping': demoMonitorMapping,
  '/api/ups': demoUps,
  // Days until each node's disk is full (#670): made-up, around the board's own disks.
  '/api/disk-forecast': demoDiskForecast,
  '/api/gitea/activity': demoGiteaActivity,
  '/api/cron': () => [],
  '/api/cron/status': demoCronStatus,
  '/api/integrations': demoIntegrations,
  // The preset gallery is code in the image, not live data (empty unless
  // boot() loaded the registry).
  '/api/integrations/presets': () => listPresets(),
  // The status model of the board above, built by the live model (#437).
  '/api/status': demoStatus,
  '/api/todos': demoTodos,
  // No outbound, so no weather: an answer without a temperature draws none.
  '/api/weather': () => ({}),
  // boot() loads no icon index in demo mode: the live route's answer without one.
  '/api/icons': () => ({ count: 0, results: [] }),
  // Settings → Notifications (#320): the lines the demo's status is judged by,
  // and push off, as above: no phones, nothing sent.
  '/api/thresholds': () => ({
    thresholds: thresholdView(thresholdsOf(demoDisplayConfig()), DEFAULT_THRESHOLDS),
  }),
  // Alerts on this device (#653): Web Push off in the demo, so the panel says so.
  '/api/push/web/key': () => ({ enabled: false, reason: 'unset' }),
  '/api/push/web/subscriptions': () => ({ enabled: false, subscriptions: [] }),
  // Alert rules (#669): nothing held, snoozed or acknowledged in the demo.
  '/api/push/alerts': () => ({ held: 0, snoozed: [], acked: [] }),
  '/api/push/devices': () => ({
    enabled: false,
    channels: { web: false },
    stalled: null,
    defaults: DEFAULT_PREFS,
    devices: [],
    test: null,
    cooldownS: TEST_PUSH_COOLDOWN_MS / 1000,
  }),
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
  // table and fall through to a 404. Drop it (except on the root path itself).
  const p = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  // 2. Icons: the browser fetches them from the icon repository itself.
  if (p === '/api/icons/cached') {
    const url = canonicalIconUrl(query.url);
    return url
      ? { status: 302, location: url }
      : { status: 404, body: { error: 'Not a cached icon' } };
  }
  // 3. An app tab's embed check: the demo saves no app tab, so the live
  // route's answer for any tab id is that it has none (the page then shows the
  // frame as the browser draws it).
  if (p.startsWith('/api/embed-check/')) {
    return { status: 404, body: { error: 'No saved app tab has that id' } };
  }
  // 4. The history charts (#311): the live route's 400s and 404, and made-up
  // readings for the demo's nodes and containers.
  if (p === '/api/history') return demoHistory({ query, now });
  // 5. The alert history (#314): the demo's own (demoEvents.js), in the live
  // store, paged and filtered by the live route's query reader, so a query it
  // can't read is the live 400.
  if (p === '/api/events') {
    const read = readEventsQuery(query);
    if (read.error) return { status: 400, body: { error: read.error } };
    const history = createAlertHistory({ now: () => now });
    history.load(demoEvents({ scenario, now }));
    return { status: 200, body: history.page(read.page) };
  }
  // 6. Reads: a fixture, else the live server's answer for an /api path it
  // has no route for (index.js). Never a real route.
  if (Object.hasOwn(READS, p)) return { status: 200, body: READS[p]({ scenario, now }) };
  return { status: 404, body: { error: 'Endpoint not found' } };
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
