/**
 * GET /api/logs?entity=<node>|<node>/<container> (#672): the last error-ish
 * lines of that node or container from Loki (lokiLogs.js). A malformed entity
 * is a 400 and one the server doesn't know a 404; a Loki that is unset or
 * doesn't answer is a 200 with `state: 'unavailable'` and a sentence.
 */
import { Router } from 'express';

import { logPeek } from '../lokiLogs.js';
import { apiError } from '../errors.js';
import { asyncHandler } from '../util/asyncHandler.js';

const router = Router();

router.get('/logs', asyncHandler(async (req, res) => {
  const { status, body } = await logPeek.answer(req.query.entity);
  if (status !== 200) return apiError(res, status, body.error);
  res.set('Cache-Control', 'no-store');
  return res.json(body);
}));

export { router as logsRoutes };
