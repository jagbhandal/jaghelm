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
 */

import { Router } from 'express';

import { refreshUPS } from '../refresh.js';
import { refreshGitea } from '../gitea.js';
import { historyCache, parseHistoryQuery } from '../promHistory.js';
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

export { router as infrastructureRoutes };
