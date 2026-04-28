/**
 * Cron job reporting endpoints.
 *
 *   POST /api/cron/report  → ingestion endpoint for cron scripts on any node.
 *                            Authenticated with JAGHELM_CRON_SECRET (header is
 *                            inappropriate here because cron scripts are simple
 *                            curl invocations); does NOT use session auth.
 *
 *   GET  /api/cron/status  → grouped statuses for the dashboard UI.
 *                            Uses session auth (mounted with authMiddleware).
 */

import { Router } from 'express';

import { authMiddleware } from '../auth/middleware.js';
import { recordRun, getAllStatuses } from '../cron-store.js';
import { apiError } from '../errors.js';

const router = Router();

router.post('/report', (req, res) => {
  const secret = process.env.JAGHELM_CRON_SECRET || '';
  if (!secret || req.body?.secret !== secret) {
    return apiError(res, 401, 'Unauthorized');
  }

  const { job, node, status, duration_seconds, schedule, error } = req.body;
  if (!job || !node || !['success', 'failure'].includes(status)) {
    return apiError(res, 400, 'Missing required fields: job, node, status');
  }

  recordRun({ job, node, status, duration_seconds, schedule, error });
  res.json({ ok: true });
});

router.get('/status', authMiddleware, (req, res) => {
  res.json(getAllStatuses());
});

export { router as cronRoutes };
