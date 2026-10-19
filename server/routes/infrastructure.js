/**
 * Infrastructure-data routes.
 *
 * Thin readers of data the background refresh loop already collected. UPS and
 * Gitea use its warm cache, with cold-start fallbacks.
 *
 *   GET /api/ups              → battery + load (warm-cached via refresh loop)
 *   GET /api/gitea/activity   → recent commits (warm-cached via refresh loop)
 */

import { Router } from 'express';

import { refreshUPS, refreshGitea } from '../refresh.js';
import { getHistory } from '../history.js';
import { respondWarmCached } from '../cache.js';
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
// Deliberately NOT ETag-cached: it changes every cycle (that's the point), and a
// 304 path would defeat the live sparkline. Kept off /api/services so the main
// board stays 304-stable.

router.get('/history', (req, res) => {
  res.json(getHistory());
});

export { router as infrastructureRoutes };
