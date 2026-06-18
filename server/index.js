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
import helmet from 'helmet';      
import { fileURLToPath } from 'url';
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
import { startBackgroundRefresh } from './refresh.js';

// Shared utilities
import { createUploadMiddleware } from './upload.js';

// Auth
import { authMiddleware, requireAuthEnabled } from './auth/middleware.js';
import { authEnabled } from './auth/passwords.js';
import { authRoutes } from './auth/routes.js';
import { errorHandler } from './errors.js';
import { VERSION } from './version.js';

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

// ── Paths ─────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3099;

const uploadsDir = join(__dirname, '..', 'uploads');
const dataDir = join(__dirname, '..', 'data');
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

// ── App + middleware ──────────────────────────────────────────────────────

const app = express();
// ── Trust proxy ───────────────────────────────────────────────────────────
// Behind a reverse proxy, X-Forwarded-For determines req.ip — which the
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
  .map(s => s.trim())
  .filter(Boolean);
if (trustProxy.length > 0) {
  app.set('trust proxy', trustProxy);
}

// CSP stays off until the frontend is audited for a nonce/hash strategy
// (currently relies on inline styles + dynamic theme injection). Everything
// else is explicitly enabled so future helmet defaults can't quietly regress.
app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: { action: 'deny' },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  noSniff: true,
  referrerPolicy: { policy: 'no-referrer' },
}));

const upload = createUploadMiddleware(uploadsDir);

// ── CORS lock-down ────────────────────────────────────────────────────────
// Allow-list driven by CORS_ORIGIN env (comma-separated). When unset, cross-
// origin requests are blocked entirely — JagHelm serves its own SPA from
// the same origin, so this is the safe default for homelab deployments.
const corsOriginEnv = (process.env.CORS_ORIGIN || '').trim();
const corsOrigins = corsOriginEnv
  ? corsOriginEnv.split(',').map(s => s.trim()).filter(Boolean)
  : false;
app.use(cors({ origin: corsOrigins }));

// 1 MB request bodies are plenty for JSON config + small uploads (binary
// uploads go through multer, which has its own limits in upload.js).
app.use(express.json({ limit: '1mb' }));
app.disable('etag'); // We manage ETags manually via cache.jsonWithEtag
app.use('/uploads', express.static(uploadsDir));

// ── Public routes ─────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/icons', iconRoutes);
app.use('/api', systemRoutes); // /health public; /weather authed inside

// ── Auth-protected routes ─────────────────────────────────────────────────

app.use('/api/services', authMiddleware, servicesRoutes);
app.use('/api/integrations', authMiddleware, integrationRoutes);
// Standalone secrets API is fail-closed: refuses to serve (enumerate/overwrite/
// delete credentials) until a password is set. Does not affect integration save.
app.use('/api/secrets', requireAuthEnabled, authMiddleware, secretsRoutes);
app.use('/api/display-config', authMiddleware, displayConfigRoutes);
app.use('/api/todos', authMiddleware, todosRoutes);
app.use('/api/upload', authMiddleware, createUploadRoutes(upload));
app.use('/api', authMiddleware, infrastructureRoutes);

// ── Static assets + SPA fallback ──────────────────────────────────────────

const distPath = join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.all('/api/*', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.get('*', (req, res) => res.sendFile(join(distPath, 'index.html')));

// Global error handler — keeps the JSON error contract for async route
// rejections (asyncHandler forwards them here) instead of an HTML 500.
app.use(errorHandler);

// ── Boot sequence ─────────────────────────────────────────────────────────

async function boot() {
  const promUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
  const kumaUrl = process.env.KUMA_URL || 'http://localhost:3001';

  initSecrets();
  initDiscovery(promUrl);
  initMonitors(kumaUrl);
  initIconCache(dataDir);
  await initRegistry();

  // Non-blocking — icon search returns empty until the index is ready
  initIconIndex().catch((err) => console.warn('[icons] Background init failed:', err.message));

  // Load services.yaml or auto-generate one from discovery on first boot
  let config = loadConfig();
  if (!config) {
    console.log('[boot] First boot — running node discovery...');
    const nodeLabels = await discoverNodes();
    console.log('[boot] Discovered nodes:', nodeLabels);
    config = generateDefaultConfig(nodeLabels);
    saveConfig(config);
  }

  startConfigWatcher();
  startBackgroundRefresh();

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('[jaghelm] v%s on port %d', VERSION, PORT);
    console.log('[jaghelm] Nodes: %s', Object.keys(config.nodes || {}).join(', ') || '(none)');
    if (!authEnabled()) {
      console.warn(
        '[jaghelm] ⚠ NO PASSWORD SET — the dashboard is unauthenticated. Anyone who can reach ' +
          'port %d can read your config and metrics. Set DASH_PASS (or a password in Settings) ' +
          'and avoid exposing this port beyond a trusted LAN.',
        PORT
      );
    }
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────
  // Stop accepting connections, let in-flight requests drain, then exit.
  // TODO: coordinate with refresh.js to cancel the background refresh timer
  // so we don't log "Cannot set headers after they are sent" during drain —
  // server/refresh.js doesn't currently export a stop hook.
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[jaghelm] ${signal} received, shutting down...`);
    const forceExit = setTimeout(() => {
      console.warn('[jaghelm] Forced exit after 10s drain timeout');
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    server.close((err) => {
      if (err) {
        console.error('[jaghelm] Error during shutdown:', err);
        process.exit(1);
      }
      console.log('[jaghelm] HTTP server closed cleanly');
      process.exit(0);
    });
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

boot().catch((err) => {
  console.error('[jaghelm] Fatal boot error:', err);
  process.exit(1);
});