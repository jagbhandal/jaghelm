/**
 * The status model's endpoint (spec §6, #292).
 *
 *   GET /api/status  → the status the background loop built this cycle:
 *                      { overall, issues, subsystems, entities, sources,
 *                        thresholds } (docs/ARCHITECTURE.md §4.7), the
 *                      last the threshold lines the model judged by (#451)
 *
 * It sits beside /api/services, /api/ups and /api/cron/status, which keep their
 * shape and meaning for older Android apps (spec §6.3). The status is cached
 * by the loop with an ETag computed once per value (cache.js): its reasons
 * carry no times and its lines change only with the config, so a steady board
 * keeps one ETag from cycle to cycle and a poll gets a 304. Before the first cycle, or once the loop has not built one
 * for the cache's TTL, it answers 503: there is no status to judge from.
 *
 * When the loop built the status it serves goes out as Last-Modified, on the
 * 200 and the 304 (#499), so a client can say how old a status is however
 * long ago its own last answer came: its Date less this, by the server's own
 * clock. Being a header, it leaves the ETag one per value, and the ETag the
 * only validator: an If-Modified-Since alone never gets a 304.
 * `Cache-Control: no-cache`: a Last-Modified alone would let a browser reuse
 * the answer unasked for a tenth of its age; a status is always asked again.
 */
import { Router } from 'express';

import { getCached, jsonWithEtag } from '../cache.js';
import { apiError } from '../errors.js';

const router = Router();

router.get('/', (req, res) => {
  const status = getCached('status');
  if (!status) return apiError(res, 503, 'Status not yet available');
  res.set('Cache-Control', 'no-cache');
  return jsonWithEtag(res, req, 'status', status, { lastModified: true });
});

export { router as statusRoutes };
