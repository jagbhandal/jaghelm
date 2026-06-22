/**
 * Read-only public demo mode (DEMO_MODE=true).
 *
 * Security model — this is a new public, unauthenticated ingress, so it is
 * locked down by construction (see docs/security/STRIDE.md):
 *   - EVERY state-changing request (POST/PUT/DELETE/PATCH) is refused 403.
 *   - The middleware OWNS the entire /api surface: reads are answered from
 *     canned fixtures (or an empty default), and the request never reaches a
 *     real route — so there is NO outbound fetch, NO backend dependency, and
 *     NO secrets endpoint reachable. The demo is fully self-contained.
 *   - /metrics is at the root (not /api) and is unaffected.
 *
 * Mounted FIRST on /api in server/index.js when isDemoMode() is true, ahead of
 * auth + the real routers.
 */
import { createLogger } from './util/logger.js';

const log = createLogger('demo');

export function isDemoMode() {
  return process.env.DEMO_MODE === 'true';
}

const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// Canned, self-contained dashboard. Minimal-but-valid shapes; the frontend's
// empty states cover anything not provided.
const DEMO_DISPLAY_CONFIG = {
  title: 'JagHelm',
  subtitle: 'Live Demo',
  theme: 'dark',
  accentColor: '#6366f1',
  showSearch: true,
  showWeather: false,
  showDots: true,
  refreshInterval: 30,
  links: {
    demo: [
      { name: 'GitHub', icon: '🐙', url: 'https://github.com/jagbhandal/jaghelm' },
      { name: 'Docs', icon: '📖', url: 'https://github.com/jagbhandal/jaghelm#readme' },
    ],
  },
};

const DEMO_SERVICES_CONFIG = {
  nodes: {
    'demo-1': {
      display_name: 'Gateway',
      subtitle: 'Raspberry Pi 5',
      icon: '🛡',
      border_color: '#a78bfa',
    },
    'demo-2': {
      display_name: 'Production',
      subtitle: 'VM 103',
      icon: '🚀',
      border_color: '#6366f1',
    },
  },
  services: {},
  integrations: {},
};

const DEMO_SERVICES = {
  nodes: {
    'demo-1': {
      label: 'demo-1',
      cpu: 12,
      memory: { used: 2.1, total: 8, percent: 26 },
      uptime: 1209600,
      containers: [
        { name: 'adguard', status: 'running', monitor: 'up' },
        { name: 'prometheus', status: 'running', monitor: 'up' },
      ],
    },
    'demo-2': {
      label: 'demo-2',
      cpu: 34,
      memory: { used: 9.4, total: 16, percent: 59 },
      uptime: 864000,
      containers: [
        { name: 'grafana', status: 'running', monitor: 'up' },
        { name: 'nextcloud', status: 'running', monitor: 'up' },
        { name: 'gitea', status: 'running', monitor: 'down' },
      ],
    },
  },
};

// Exact-path fixtures. Anything else under /api returns EMPTY (no route runs).
const FIXTURES = {
  '/api/health': { status: 'ok', demo: true, version: 'demo' },
  '/api/readyz': { ready: true, demo: true, checks: { prometheus: true, kuma: true } },
  '/api/display-config': DEMO_DISPLAY_CONFIG,
  '/api/services': DEMO_SERVICES,
  '/api/services/config': DEMO_SERVICES_CONFIG,
  '/api/services/monitors': ['adguard', 'prometheus', 'grafana', 'nextcloud', 'gitea'],
  '/api/integrations': {},
  '/api/cron': [],
  '/api/cron/status': [],
  '/api/todos': [
    { id: 1, text: 'Welcome to the JagHelm demo — everything here is read-only', done: false },
  ],
  '/api/auth/check': { authenticated: true, authRequired: false, demo: true },
};

export function demoMiddleware(req, res, next) {
  // 1. Refuse every state-changing request.
  if (MUTATING.has(req.method)) {
    return res.status(403).json({ error: 'This is a read-only demo' });
  }
  // 2. Reads: serve a fixture, else an empty object. Never call next() for /api,
  //    so no real route runs → no outbound, no secrets, no backend needed.
  //    Mounted at /api, so req.path is mount-relative — reconstruct the full path.
  //    Express does NOT strip a trailing slash, so "/api/services/" would miss the
  //    FIXTURES map and fall through to {}. Normalize by dropping a trailing "/"
  //    (except the root path itself) before the lookup.
  let fullPath = req.baseUrl + req.path;
  if (fullPath.length > 1 && fullPath.endsWith('/')) {
    fullPath = fullPath.slice(0, -1);
  }
  if (Object.prototype.hasOwnProperty.call(FIXTURES, fullPath)) {
    return res.json(FIXTURES[fullPath]);
  }
  return res.json({});
}

export function logDemoBanner(port) {
  log.warn(
    { port },
    'DEMO_MODE is ON — /api is read-only and self-contained (no writes, no secrets, no outbound). Do NOT use for a real dashboard.'
  );
}
