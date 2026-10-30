/**
 * Infrastructure-data routes.
 *
 * Thin readers of data the background refresh loop already collected. UPS and
 * Gitea use its warm cache, with cold-start fallbacks.
 *
 *   GET /api/ups              → battery + load, whether a UPS is set up and its
 *                               model (warm-cached via refresh loop)
 *   GET /api/gitea/activity   → recent commits, or { configured: false } without
 *                               JAGHELM_GITEA_URL (polled every 5 minutes,
 *                               gitea.js; Last-Modified: when Gitea answered)
 *   GET /api/history          → a node's or a container's readings over 1h,
 *                               24h or 7d, from Prometheus query_range
 *                               (promHistory.js: predefined series only,
 *                               cached per step; ETag)
 *   GET /api/monitoring       → every chart of the Monitoring page over 1h, 24h, 7d or 30d
 *                               (monitoring.js: a server-side chart table, each chart
 *                               cached per step and failing on its own; ETag)
 *   GET /api/disk-forecast    → days until full per visible node, a line fitted
 *                               to a week of Prometheus disk use (diskForecast.js,
 *                               one answer shared for 10 minutes; ETag)
 *   GET /api/host-actions     → the unticked rows of homelab-infra #848, the pending
 *                               host steps, or { configured: false } without a Gitea
 *                               URL and token (hostActions.js, 5-minute cache; ETag)
 *   GET /api/expiry           → TLS certificates and Tailscale node keys, days left
 *                               (expiry.js; { configured: false } when neither is set up)
 *   GET /api/backups          → the Overview's Backups section (#675): each marked backup
 *                               job's last good run from the cron store, and the B2 bucket's
 *                               saved size samples (backups.js; no request leaves the server;
 *                               ETag)
 */

import { Router } from 'express';

import { refreshUPS } from '../refresh.js';
import { refreshGitea } from '../gitea.js';
import { diskForecastCache } from '../diskForecast.js';
import { backupsAnswer } from '../backups.js';
import { hostActionsAnswer } from '../hostActions.js';
import { expiryAnswer } from '../expiry.js';
import { historyCache, parseHistoryQuery } from '../promHistory.js';
import { monitoringCache, parseMonitoringRange, MONITORING_RANGES } from '../monitoring.js';
import { respondWarmCached, jsonWithEtag } from '../cache.js';
import { apiError } from '../errors.js';
import { asyncHandler } from '../util/asyncHandler.js';

const router = Router();

// ── UPS (warm-cached) ────────────────────────────────────────────────────

router.get('/ups', asyncHandler((req, res) =>
  respondWarmCached(req, res, {
    key: 'ups',
    refresh: refreshUPS,
    fallback: (r) => apiError(r, 502, 'UPS data not yet available'),
  })
));

// ── Gitea recent commits (warm-cached) ───────────────────────────────────

// Last-Modified is when Gitea last answered: the list's age, which a failed
// poll leaves growing (gitea.js, #249).
router.get('/gitea/activity', asyncHandler((req, res) =>
  respondWarmCached(req, res, {
    key: 'gitea',
    refresh: refreshGitea,
    fallback: (r) => apiError(r, 502, 'Gitea data not yet available'),
    lastModified: true,
  })
));

// ── History charts (#311) ────────────────────────────────────────────────
// ?series=node.cpu[,node.memory,…]&entity=<node>|<node>/<container>&range=1h|24h|7d
// An unknown series or range, or a malformed entity, is a 400, and a node
// services.yaml doesn't have a 404. Each series is answered, or failed with
// Prometheus's error (never an empty line), from promHistory.js' cache. The
// ETag is a hash of this response, so a poll within the step costs a 304.

router.get('/history', asyncHandler(async (req, res) => {
  const parsed = parseHistoryQuery(req.query);
  if (!parsed.ok) return apiError(res, parsed.status, parsed.error);
  const { status, body } = await historyCache.answer(parsed);
  if (status !== 200) return apiError(res, status, body.error);
  return jsonWithEtag(res, req, 'history', body);
}));

// ── Monitoring page (#751) ───────────────────────────────────────────────
// ?range=1h|24h|7d|30d. Every chart of the page in one answer, each from its
// own (chart, range) cache entry; a chart Prometheus can't answer is
// { ok: false, error } with its fixed sentence, never an empty line. The
// client names a range only: the queries are monitoring.js' table. The ETag
// is a hash of this response, so a poll within the step costs a 304.

router.get('/monitoring', asyncHandler(async (req, res) => {
  const range = parseMonitoringRange(req.query);
  if (range === null) return apiError(res, 400, `Unknown range: one of ${MONITORING_RANGES.join(', ')}`);
  const body = await monitoringCache.answer(range);
  return jsonWithEtag(res, req, 'monitoring', body);
}));

// ── Disk forecast (#670) ─────────────────────────────────────────────────
// Days until full per visible node, from a week of Prometheus readings
// (diskForecast.js). One answer shared by every reader for 10 minutes; a
// Prometheus that fails is `ok: false` with its fixed sentence, never a guess.

router.get('/disk-forecast', asyncHandler(async (req, res) => {
  const { body } = await diskForecastCache.answer();
  return jsonWithEtag(res, req, 'disk-forecast', body);
}));

// ── Pending host steps (#673) ────────────────────────────────────────────
// Read-only. Never an error status: a Gitea that doesn't answer is
// { ok: false } with the link to the list, and no Gitea set up is
// { configured: false }, which the Overview draws as no tile.

router.get('/host-actions', asyncHandler(async (req, res) => {
  const body = await hostActionsAnswer();
  return jsonWithEtag(res, req, 'host-actions', body);
}));

// ── Expiry tracker (#676) ────────────────────────────────────────────────
// Read-only. The server's own certificate reads (every 6 hours) and the
// Tailscale device list (cached 6 hours): this only builds the answer, with
// days left worked out now. Never an error status.

router.get('/expiry', asyncHandler(async (req, res) => {
  const body = await expiryAnswer();
  return jsonWithEtag(res, req, 'expiry', body);
}));
// ── Backups (#675) ──────────────────────────────────────────────────────
// Read-only and local: the cron store and the saved B2 samples. The daily B2
// job is the only thing that talks to Backblaze, never a request.

router.get('/backups', (req, res) => jsonWithEtag(res, req, 'backups', backupsAnswer()));

export { router as infrastructureRoutes };
