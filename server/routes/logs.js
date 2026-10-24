/**
 * GET /api/logs?entity=<node>|<node>/<container> (#672): the last error-ish
 * lines of that node or container from Loki (lokiLogs.js). A malformed entity
 * is a 400 and one the server doesn't know a 404; a Loki that is unset or
 * doesn't answer is a 200 with `state: 'unavailable'` and a sentence.
 *
 * Raw logs are as sensitive as the secrets API: with no dashboard password set
 * (authMiddleware then lets everyone in) it answers `unavailable` and asks
 * Loki nothing, unless JAGHELM_ALLOW_OPEN_SECRETS=true, the same escape hatch
 * the secrets routes have (auth/middleware.js requireAuthEnabled).
 */
import { Router } from 'express';

import { logPeek } from '../lokiLogs.js';
import { authEnabled } from '../auth/passwords.js';
import { envValue } from '../env.js';
import { apiError } from '../errors.js';
import { asyncHandler } from '../util/asyncHandler.js';

const router = Router();

const OPEN = 'logs stay off until a dashboard password is set (DASH_PASS)';

router.get('/logs', asyncHandler(async (req, res) => {
  if (!authEnabled() && envValue('JAGHELM_ALLOW_OPEN_SECRETS') !== true) {
    res.set('Cache-Control', 'no-store');
    return res.json({ state: 'unavailable', lines: [], reason: OPEN });
  }
  const { status, body } = await logPeek.answer(req.query.entity);
  if (status !== 200) return apiError(res, status, body.error);
  res.set('Cache-Control', 'no-store');
  return res.json(body);
}));

export { router as logsRoutes };
