/**
 * The status model's endpoint (spec §6, #292).
 *
 *   GET /api/status  → the status the background loop built this cycle:
 *                      { overall, issues, subsystems, entities, sources }
 *                      (docs/ARCHITECTURE.md §4.7)
 *
 * It sits beside /api/services, /api/ups and /api/cron/status, which keep their
 * shape and meaning for older Android apps (spec §6.3). The status is cached
 * by the loop with an ETag computed once per value (cache.js): its reasons
 * carry no times, so a steady board keeps one ETag from cycle to cycle and a
 * poll gets a 304. Before the first cycle, or once the loop has not built one
 * for the cache's TTL, it answers 503: there is no status to judge from.
 */
import { Router } from 'express';

import { getCached, jsonWithEtag } from '../cache.js';
import { apiError } from '../errors.js';

const router = Router();

router.get('/', (req, res) => {
  const status = getCached('status');
  if (!status) return apiError(res, 503, 'Status not yet available');
  return jsonWithEtag(res, req, 'status', status);
});

export { router as statusRoutes };
