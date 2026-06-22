/**
 * JagHelm — Express server entry point.
 *
 * This file does as little as possible: it wires modules together, mounts
 * routes with their middleware, and runs the boot sequence. All business
 * logic lives in the focused modules under server/.
 *
 *   server/auth/         — sessions, passwords, rate limit, /api/auth/* routes
 *   server/routes/       — every other route, grouped by domain
 *   server/refresh.js    — background refresh loop + per-domain refresh fns
 *   server/cache.js      — in-memory response cache + ETag helper
 *   server/errors.js     — apiError() wrapper for uniform error responses
 *   server/upload.js     — multer config for logo/background uploads
 *   server/httpClient.js — safeFetch with default timeout
 *   server/config.js     — services.yaml load/save/watch
 *   server/secrets.js    — AES-256-GCM encrypted credentials
 *   server/discovery.js  — Prometheus node + container discovery
 *   server/monitors.js   — Uptime Kuma monitor matching
 *   server/icons.js      — bundled icon search index
 *   server/icon-cache.js — local disk cache for CDN icons
 *   server/cron-store.js — cron job execution history
 *   server/integrations/ — preset gallery + fetch handler
 */

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config();

// Subsystem initializers + persistent state
import { loadConfig, saveConfig, generateDefaultConfig, startConfigWatcher } from './config.js';
import { initSecrets } from './secrets.js';
import { initDiscovery, discoverNodes } from './discovery.js';
import { initMonitors } from './monitors.js';
import { initRegistry } from './integrations/registry.js';
import { initIconIndex } from './icons.js';
import { initIconCache } from './icon-cache.js';
import { startBackgroundRefresh, stopBackgroundRefresh } from './refresh.js';

// Shared utilities
import { createUploadMiddleware } from './upload.js';

// Auth
import { authMiddleware, requireAuthEnabled } from './auth/middleware.js';
import { authEnabled } from './auth/passwords.js';
import { authRoutes } from './auth/routes.js';
import { errorHandler } from './errors.js';
import { VERSION } from './version.js';
import { createLogger } from './util/logger.js';
import { metricsMiddleware, metricsHandler } from './metrics.js';
import { isDemoMode, demoMiddleware, logDemoBanner } from './demo.js';

const log = createLogger('jaghelm');

// Domain routes
import { servicesRoutes } from './routes/services.js';
import { integrationRoutes } from './routes/integrations.js';
import { infrastructureRoutes } from './routes/infrastructure.js';
import { secretsRoutes } from './routes/secrets.js';
import { displayConfigRoutes } from './routes/displayConfig.js';
import { todosRoutes } from './routes/todos.js';
import { createUploadRoutes } from './routes/upload.js';
import { iconRoutes } from './routes/icons.js';
import { cronRoutes } from './routes/cron.js';
import { systemRoutes } from './routes/system.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3099;

const uploadsDir = join(__dirname, '..', 'uploads');
const dataDir = join(__dirname, '..', 'data');
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const app = express();
// Trust proxy: behind a reverse proxy, X-Forwarded-For determines req.ip — which the
// login rate limiter buckets by. Trust ONLY specific upstream IPs/ranges
// listed in TRUST_PROXY (comma-separated). Never use `true` — that lets
// any client spoof their IP via X-Forwarded-For and bypass rate limiting.
//
// Examples:
//   TRUST_PROXY=192.168.1.10                    (single proxy)
//   TRUST_PROXY=192.168.1.10,192.168.1.11       (primary + failover)
//   TRUST_PROXY=loopback,linklocal,uniquelocal  (Express built-in: trust private nets)
//   TRUST_PROXY=                                 (unset/blank: don't trust any proxy)
const trustProxy = (process.env.TRUST_PROXY || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (trustProxy.length > 0) {
  app.set('trust proxy', trustProxy);
}

// Count + time every request (Prometheus metrics) and emit a structured access
// log line on completion. Mounted first so it brackets the whole pipeline.
// The scrape/health endpoints are skipped in the access log to avoid spam.
app.use(metricsMiddleware);
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/metrics' || req.path === '/api/health' || req.path === '/api/readyz') return;
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    const fields = { method: req.method, path: req.path, status: res.statusCode, ms };
    if (res.statusCode >= 500) log.error(fields, 'request');
    else if (req.path.startsWith('/api/')) log.info(fields, 'request');
    else log.debug(fields, 'request');
  });
  next();
});

// Content-Security-Policy. The frontend uses React inline styles + dynamic
// theme CSS-var injection (style ATTRIBUTES, which can't be nonced), Google
// Fonts, and CDN dashboard-icons, and embeds operator-configured service URLs
// via the iframe view — so style-src must keep 'unsafe-inline'. The meaningful
// protection here is the strict script-src ('self' only): Vite bundles all JS
// to hashed files and the SW-registration inline script was externalized to
// /register-sw.js, so no inline/eval script is allowed. object-src/base-uri are
// locked down to kill the classic injection vectors. ENFORCES by default (this is
// the app's primary XSS containment); set CSP_REPORT_ONLY=true to fall back to a
// report-only header while tuning a deploy that has custom inline assets.
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  imgSrc: [
    "'self'",
    'data:',
    'blob:',
    'https://cdn.jsdelivr.net',
    'https://raw.githubusercontent.com',
  ],
  connectSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://raw.githubusercontent.com'],
  // The iframe view embeds operator-configured service URLs (often http on LAN).
  frameSrc: ["'self'", 'https:', 'http:'],
  workerSrc: ["'self'"],
  manifestSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"], // nobody may embed JagHelm (matches frameguard deny)
};
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false, // avoid helmet's default upgrade-insecure-requests — breaks http LAN backends
      directives: cspDirectives,
      // Enforce by default (the strict script-src is our primary XSS containment).
      // Set CSP_REPORT_ONLY=true to fall back to report-only while tuning a deploy.
      reportOnly: process.env.CSP_REPORT_ONLY === 'true',
    },
    frameguard: { action: 'deny' },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    noSniff: true,
    referrerPolicy: { policy: 'no-referrer' },
  })
);

const upload = createUploadMiddleware(uploadsDir);

// CORS lock-down: allow-list driven by CORS_ORIGIN env (comma-separated). When unset, cross-
// origin requests are blocked entirely — JagHelm serves its own SPA from
// the same origin, so this is the safe default for homelab deployments.
const corsOriginEnv = (process.env.CORS_ORIGIN || '').trim();
const corsOrigins = corsOriginEnv
  ? corsOriginEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : false;
app.use(cors({ origin: corsOrigins }));

// gzip responses. The big win is /api/history — intentionally non-304 (it changes
// every poll) and the largest repeatedly-fetched JSON; numeric JSON gzips ~80-90%.
app.use(compression());

// 1 MB request bodies are plenty for JSON config + small uploads (binary
// uploads go through multer, which has its own limits in upload.js).
app.use(express.json({ limit: '1mb' }));
app.disable('etag'); // We manage ETags manually via cache.jsonWithEtag
app.use('/uploads', express.static(uploadsDir));

// Prometheus scrape endpoint (root path, by convention). Public like /health —
// it exposes request counts/timings, not secrets, and Prometheus must reach it.
app.get('/metrics', metricsHandler);

// Read-only public demo: when DEMO_MODE=true this owns the whole /api surface
// (refuses all writes, serves canned fixtures, never reaches a real route or
// outbound) — mounted BEFORE auth + the routers. See server/demo.js.
if (isDemoMode()) app.use('/api', demoMiddleware);

app.use('/api/auth', authRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/icons', iconRoutes);
app.use('/api', systemRoutes); // /health + /readyz public; /weather authed inside

app.use('/api/services', authMiddleware, servicesRoutes);
app.use('/api/integrations', authMiddleware, integrationRoutes);
// Standalone secrets API is fail-closed: refuses to serve (enumerate/overwrite/
// delete credentials) until a password is set. Does not affect integration save.
app.use('/api/secrets', requireAuthEnabled, authMiddleware, secretsRoutes);
app.use('/api/display-config', authMiddleware, displayConfigRoutes);
app.use('/api/todos', authMiddleware, todosRoutes);
app.use('/api/upload', authMiddleware, createUploadRoutes(upload));
app.use('/api', authMiddleware, infrastructureRoutes);

const distPath = join(__dirname, '..', 'dist');
// Vite emits content-hashed filenames under /assets, so they can be cached
// forever — serve them immutable to avoid a revalidation round-trip on every
// reload. index.html and other root files keep the default (revalidated) cache.
app.use('/assets', express.static(join(distPath, 'assets'), { maxAge: '1y', immutable: true }));
app.use(express.static(distPath));
app.all('/api/*', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.get('*', (req, res) => res.sendFile(join(distPath, 'index.html')));

// Global error handler — keeps the JSON error contract for async route
// rejections (asyncHandler forwards them here) instead of an HTML 500.
app.use(errorHandler);

// Keep a single stray rejection / thrown error from killing the whole
// single-instance dashboard. Log loudly; the container restart policy is the
// backstop for a genuinely unrecoverable state.
process.on('unhandledRejection', (reason) => {
  log.error({ err: reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  log.error({ err }, 'uncaught exception (continuing)');
});

async function boot() {
  const promUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
  const kumaUrl = process.env.KUMA_URL || 'http://localhost:3001';

  initSecrets();
  initDiscovery(promUrl);
  initMonitors(kumaUrl);
  initIconCache(dataDir);
  await initRegistry();

  // Non-blocking — icon search returns empty until the index is ready
  initIconIndex().catch((err) => log.warn({ err }, 'icon index background init failed'));

  // Load services.yaml or auto-generate one from discovery on first boot
  let config = loadConfig();
  if (!config) {
    log.info('first boot — running node discovery');
    const nodeLabels = await discoverNodes();
    log.info({ nodes: nodeLabels }, 'discovered nodes');
    config = generateDefaultConfig(nodeLabels);
    saveConfig(config);
  }

  startConfigWatcher();
  startBackgroundRefresh();

  const server = app.listen(PORT, '0.0.0.0', () => {
    log.info({ version: VERSION, port: PORT }, 'listening');
    log.info({ nodes: Object.keys(config.nodes || {}) }, 'active nodes');
    if (isDemoMode()) logDemoBanner(PORT);
    if (!authEnabled()) {
      log.warn(
        { port: PORT },
        '⚠ NO PASSWORD SET — the dashboard is unauthenticated. Anyone who can reach this ' +
          'port can read your config and metrics. Set DASH_PASS (or a password in Settings) ' +
          'and avoid exposing this port beyond a trusted LAN.'
      );
    }
  });

  // Graceful shutdown: stop accepting connections, cancel the background refresh timer so it can't
  // fire mid-drain, let in-flight requests finish, then exit.
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    stopBackgroundRefresh();
    const forceExit = setTimeout(() => {
      log.warn('forced exit after 10s drain timeout');
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    server.close((err) => {
      if (err) {
        log.error({ err }, 'error during shutdown');
        process.exit(1);
      }
      log.info('HTTP server closed cleanly');
      process.exit(0);
    });
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Only boot (subsystem init + listen) when run directly. When imported (route
// tests), the app is fully route-mounted but doesn't bind a port or start loops.
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  boot().catch((err) => {
    log.error({ err }, 'fatal boot error');
    process.exit(1);
  });
}

export { app };
