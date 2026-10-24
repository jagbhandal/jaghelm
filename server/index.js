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
 *   server/accessLog.js  — one structured log line per request
 *   server/upload.js     — multer config for logo/background uploads
 *   server/httpClient.js — safeFetch with default timeout
 *   server/env.js        — the environment: every variable, checked once at boot
 *   server/config.js     — services.yaml load/save/watch
 *   server/firstBoot.js  — first boot: discovery until it finds nodes, then one save
 *   server/secrets.js    — AES-256-GCM encrypted credentials
 *   server/discovery.js  — Prometheus node + container discovery
 *   server/monitors.js   — Uptime Kuma monitor matching
 *   server/icons.js      — icon search index (persisted names, fetched lazily)
 *   server/icon-cache.js — local disk cache for CDN icons
 *   server/cron-store.js — cron job execution history
 *   server/integrations/ — preset gallery + fetch handler
 */

// First, before any module reads the environment (env.js, at import): the .env
// in the working directory, for `npm start` (#249). A variable already set in
// the process wins; under Docker, compose's env_file sets them all.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

// Subsystem initializers + persistent state
import { migrateDisplayUnits } from './displayUnits.js';
import { loadConfig, startConfigWatcher, stopConfigWatcher } from './config.js';
import { firstBoot } from './firstBoot.js';
import { initSecrets } from './secrets.js';
import { initDiscovery } from './discovery.js';
import { initMonitors } from './monitors.js';
import { sourceUrl, warnRefusedSourceUrls } from './sourceUrls.js';
import { initRegistry } from './integrations/registry.js';
import { reportUnusedIntegrationSecrets } from './integrations/unusedSecrets.js';
import { bindSecretsAtBoot } from './integrations/secretBinding.js';
import { initIconIndex } from './icons.js';
import { initIconCache } from './icon-cache.js';
import { DATA_DIR } from './util/dataDir.js';
import { envValue, reportEnv, resolveBindHost } from './env.js';
import {
  pushSender,
  pushSnapshot,
  startBackgroundRefresh,
  stopBackgroundRefresh,
  testPush,
} from './refresh.js';
import { refreshHint } from './refreshHint.js';
import * as fcmModule from './push/fcm.js';
import { startArcane, stopArcane } from './arcane/index.js';

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
import { createAccessLog } from './accessLog.js';
import { isDemoMode, demoMiddleware, logDemoBanner } from './demo.js';
import { demoServicesConfig } from './demoFixtures.js';

const log = createLogger('jaghelm');

// Domain routes
import { servicesRoutes } from './routes/services.js';
import { statusRoutes } from './routes/status.js';
import { integrationRoutes } from './routes/integrations.js';
import { infrastructureRoutes } from './routes/infrastructure.js';
import { secretsRoutes } from './routes/secrets.js';
import { displayConfigRoutes } from './routes/displayConfig.js';
import { thresholdsRoutes } from './routes/thresholds.js';
import { setupRoutes } from './routes/setup.js';
import { todosRoutes } from './routes/todos.js';
import { createUploadRoutes } from './routes/upload.js';
import { iconRoutes } from './routes/icons.js';
import { cronRoutes } from './routes/cron.js';
import { systemRoutes } from './routes/system.js';
import { createPushRoutes } from './routes/push.js';
import { createEmbedCheckRoutes } from './routes/embedCheck.js';
import { createEventsRoutes } from './routes/events.js';
import { getPushChannels, getPushStore, getWebPushStore } from './push/store.js';
import { initWebPush, webPushStatus } from './push/channels.js';
import { createWebPushRoutes } from './routes/webPush.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = envValue('PORT'); // default 3099
const HOST = resolveBindHost(); // JAGHELM_HOST, default 0.0.0.0

const uploadsDir = join(__dirname, '..', 'uploads');
// Demo mode writes nothing, not even these directories (#248).
if (!isDemoMode()) {
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

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
const trustProxy = envValue('TRUST_PROXY');
if (trustProxy.length > 0) {
  app.set('trust proxy', trustProxy);
}

// Count + time every request (Prometheus metrics) and emit a structured access
// log line on completion. Mounted first so it brackets the whole pipeline.
// Levels, the logged path and the skipped probe endpoints: see accessLog.js.
app.use(metricsMiddleware);
app.use(createAccessLog({ logger: log }));

// Content-Security-Policy. The frontend uses React inline styles + dynamic
// theme CSS-var injection (style ATTRIBUTES, which can't be nonced) and CDN
// dashboard-icons, and embeds operator-configured service URLs via the iframe
// view — so style-src must keep 'unsafe-inline'. Fonts are self-hosted (#244,
// #284): no font or stylesheet comes from another origin. The meaningful
// protection here is the strict script-src ('self' only): Vite bundles all JS
// to hashed files and the SW-registration inline script was externalized to
// /register-sw.js, so no inline/eval script is allowed. object-src/base-uri are
// locked down to kill the classic injection vectors. ENFORCES by default (this is
// the app's primary XSS containment); set CSP_REPORT_ONLY=true to fall back to a
// report-only header while tuning a deploy that has custom inline assets.
// Additive, env-gated connect-src extension for a WebView-fetch fallback
// deployment. Unset ⇒ no extra origins ⇒ connect-src is byte-for-byte as today.
//
// Helmet does NOT validate CSP directive values; it passes them through
// verbatim. We validate entries ourselves: only well-formed http/https/wss/ws
// origins are accepted. Anything else (bare *, javascript: URIs, entries with
// whitespace/semicolons/quotes) is dropped with a warning so a misconfigured
// operator env can't silently widen or corrupt connect-src.
const VALID_CSP_ORIGIN_RE = /^(https?|wss?):\/\/[^\s'";,]+$/;
const extraConnect = envValue('CSP_CONNECT_EXTRA')
  .filter((entry) => {
    if (VALID_CSP_ORIGIN_RE.test(entry)) return true;
    log.warn({ entry }, 'ignoring invalid CSP_CONNECT_EXTRA entry');
    return false;
  });
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  fontSrc: ["'self'", 'data:'],
  imgSrc: [
    "'self'",
    'data:',
    'blob:',
    'https://cdn.jsdelivr.net',
    'https://raw.githubusercontent.com',
  ],
  connectSrc: [
    "'self'",
    'https://cdn.jsdelivr.net',
    'https://raw.githubusercontent.com',
    ...extraConnect,
  ],
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
      reportOnly: envValue('CSP_REPORT_ONLY'),
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
const corsOriginList = envValue('CORS_ORIGIN');
const corsOrigins = corsOriginList.length > 0 ? corsOriginList : false;
// exposedHeaders:['ETag'] is REQUIRED only on the WebView-fetch fallback
// (cross-origin JS cannot read ETag by default → would silently break
// useData.js's If-None-Match 304 caching). Additive + inert: with CORS_ORIGIN
// unset (origin:false), no Access-Control-* headers are emitted, so the desktop
// same-origin response is byte-for-byte unchanged. (Native HTTP — the mobile
// default — bypasses CORS entirely and needs none of this.) Date too (#499):
// the status's age is the server's Date less its Last-Modified, by the
// server's own clock. Retry-After too (#257): the sign-in form says how long a
// refused login (429) has to wait.
app.use(cors({ origin: corsOrigins, exposedHeaders: ['ETag', 'Date', 'Retry-After', 'X-Next-Refresh-Ms'] }));

// gzip responses: the JSON payloads, a history chart's hundreds of numbers
// (/api/history, #311) among them; numeric JSON gzips ~80-90%.
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

app.use('/api/services', authMiddleware, refreshHint, servicesRoutes);
app.use('/api/status', authMiddleware, refreshHint, statusRoutes);
// The alert history (#267): what push's differ recorded, newest first.
app.use('/api/events', authMiddleware, createEventsRoutes({ history: pushSnapshot }));
app.use('/api/integrations', authMiddleware, integrationRoutes);
// Standalone secrets API is fail-closed: refuses to serve (enumerate/overwrite/
// delete credentials) until a password is set. Does not affect integration save.
app.use('/api/secrets', requireAuthEnabled, authMiddleware, secretsRoutes);
app.use('/api/display-config', authMiddleware, displayConfigRoutes);
// The threshold lines Settings → Notifications edits (#320).
app.use('/api/thresholds', authMiddleware, thresholdsRoutes);
app.use('/api/setup', authMiddleware, setupRoutes);
// Whether an app tab's headers let the browser frame it (#269).
app.use('/api/embed-check', authMiddleware, createEmbedCheckRoutes());
app.use('/api/todos', authMiddleware, todosRoutes);
// Web Push subscriptions of the installed dashboard (#653), before /api/push's own routes.
app.use(
  '/api/push/web',
  authMiddleware,
  createWebPushRoutes({ webStore: getWebPushStore(), status: webPushStatus, testPush })
);
app.use(
  '/api/push',
  authMiddleware,
  createPushRoutes({
    store: getPushStore(),
    fcm: fcmModule,
    testPush,
    sender: pushSender,
    channels: getPushChannels(),
  })
);
app.use('/api/upload', authMiddleware, createUploadRoutes(upload));
app.use('/api', authMiddleware, infrastructureRoutes);

const distPath = join(__dirname, '..', 'dist');
// Vite emits content-hashed filenames under /assets, so they can be cached
// forever — serve them immutable to avoid a revalidation round-trip on every
// reload. index.html and other root files keep the default (revalidated) cache.
// fallthrough:false makes a missing file a 404 here: falling through to the SPA
// catch-all would answer an old tab's request for a removed chunk with
// index.html and a 200, which the browser then fails to load as code (#256).
// The 404 is answered here, so it doesn't reach errorHandler's error-level log.
app.use(
  '/assets',
  express.static(join(distPath, 'assets'), { maxAge: '1y', immutable: true, fallthrough: false }),
  (err, _req, res, next) => (err.status === 404 ? res.sendStatus(404) : next(err))
);
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

/**
 * Start the subsystems a live dashboard runs, and return its services config.
 * Not in demo mode: each one reaches out (discovery, the refresh loop, Kuma,
 * push, Arcane) or writes to the data dir (secrets, the icon cache,
 * services.yaml), and the demo guard answers every /api read itself (#248).
 */
async function startSubsystems() {
  // A source URL with a user or password is refused (#419): warned once here,
  // without its value, and never used.
  const prometheus = sourceUrl('prometheus');
  const kuma = sourceUrl('kuma');
  warnRefusedSourceUrls(log);

  initSecrets();
  // Before the refresh loop and the first request read display-config.json (#322).
  migrateDisplayUnits();
  initDiscovery(prometheus.url, { problem: prometheus.problem });
  initMonitors(kuma.url, envValue('KUMA_API_KEY'), { problem: kuma.problem });
  initIconCache(DATA_DIR);

  // Push (FCM) — graceful-disable when no service-account creds are present.
  // Never throws; isPushEnabled() stays false and the pipeline no-ops.
  fcmModule.initPush({ logger: log });
  // Web Push (VAPID) for the installed dashboard (#653): off without its three variables.
  initWebPush({ store: getWebPushStore(), logger: log });

  await initRegistry();

  // Non-blocking, disk only: reads the persisted icon index; the first icon search builds it lazily
  initIconIndex().catch((err) => log.warn({ err }, 'icon index background init failed'));

  // Load services.yaml, or on first boot discover the nodes and save the
  // default with them, once there are some (firstBoot.js, #566).
  let config = loadConfig();
  // Secrets stored before #556 go only to the entries that use them, bound
  // now; while services.yaml is missing or broken, at its first good load
  // from disk (never to the default one discovery writes).
  bindSecretsAtBoot();
  if (!config) {
    config = await firstBoot();
  } else {
    // Integration secrets no entry uses (a delete before #415, or a save
    // interrupted between its two writes): counted in the log, never deleted.
    reportUnusedIntegrationSecrets();
  }
  startConfigWatcher();
  startBackgroundRefresh();
  // Arcane's notices go through the same push outbox and history (#581).
  startArcane({
    push: { snapshot: pushSnapshot, sender: pushSender },
    isPushEnabled: () => getPushChannels().isPushEnabled(),
  });
  return config;
}

/**
 * Demo mode starts only what it serves: the integration preset gallery, which
 * is code in the image (Settings lists it). Nothing else runs (#248).
 */
async function startDemo() {
  await initRegistry();
  return demoServicesConfig();
}

async function boot() {
  // The environment, checked once (env.js): one warning per old variable name
  // set, and a value that doesn't fit its variable stops the start, with a
  // line naming the variable (never the value).
  if (!reportEnv(log)) process.exit(1);
  const demo = isDemoMode();
  const config = demo ? await startDemo() : await startSubsystems();

  const server = app.listen(PORT, HOST, () => {
    // The port bound, which PORT=0 leaves to the OS.
    const port = server.address()?.port ?? PORT;
    log.info({ version: VERSION, node: process.version, host: HOST, port }, 'listening');
    log.info({ nodes: Object.keys(config?.nodes || {}) }, 'active nodes');
    if (demo) logDemoBanner(port);
    // The demo is open by design: its guard refuses every write and serves no config.
    else if (!authEnabled()) {
      log.warn(
        { port },
        '⚠ NO PASSWORD SET — the dashboard is unauthenticated. Anyone who can reach this ' +
          'port can read your config and metrics. Set DASH_PASS (or a password in Settings) ' +
          'and avoid exposing this port beyond a trusted LAN.'
      );
    }
  });
  // A JAGHELM_HOST that isn't an address of this machine, or a port in use, fails
  // listen(). Exit so it shows (the restart policy retries), rather than running on
  // with nothing listening: uncaughtException above would keep it alive.
  server.on('error', (err) => {
    log.error({ err, host: HOST, port: PORT }, 'cannot listen');
    process.exit(1);
  });

  // Graceful shutdown: stop accepting connections, cancel the background refresh timer so it can't
  // fire mid-drain (and services.yaml's watcher and retry, #536), let in-flight requests finish,
  // then exit.
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    if (!demo) {
      stopBackgroundRefresh();
      stopConfigWatcher();
      stopArcane();
    }
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
