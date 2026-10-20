/**
 * Infrastructure-data routes.
 *
 * Thin readers of data the background refresh loop already collected. UPS and
 * Gitea use its warm cache, with cold-start fallbacks.
 *
 *   GET /api/ups              → battery + load, whether a UPS is set up and its
 *                               model (warm-cached via refresh loop)
 *   GET /api/gitea/activity   → recent commits, or { configured: false } without
 *                               GITEA_URL (warm-cached via refresh loop)
 *   GET /api/history          → sparkline series (ETag, not cached)
 */

import { Router } from 'express';

import { refreshUPS, refreshGitea } from '../refresh.js';
import { getHistory } from '../history.js';
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

router.get('/gitea/activity', asyncHandler((req, res) =>
  respondWarmCached(req, res, {
    key: 'gitea',
    refresh: refreshGitea,
    fallback: (r) => apiError(r, 502, 'Gitea data not yet available'),
  })
));

// ── Metric history (sparklines) ──────────────────────────────────────────
// The last ~1h of each node's CPU/RAM/disk usage, recorded by the refresh loop.
// It changes every cycle (that's the point), so it is not cached; the ETag is a
// hash of this response, so a poll that lands before the next cycle gets a 304.
// Kept off /api/services so the main board stays 304-stable.

router.get('/history', (req, res) => {
  jsonWithEtag(res, req, 'history', getHistory());
});

export { router as infrastructureRoutes };
