/**
 * Config drift (#674).
 *
 *   POST /api/drift/report  → a host's drift check result, from a timer on that
 *                             host. Machine push, as /api/cron/report is: the
 *                             shared `secret` in the body (JAGHELM_CRON_SECRET),
 *                             compared in constant time; without it set the
 *                             endpoint is off. Strict schema and limits in
 *                             driftReports.js. JagHelm runs no check and holds
 *                             no key.
 *   GET  /api/drift         → { configured, now, reports } for the Overview row
 *                             (session auth; no ETag, since `now` moves). `configured: false` without
 *                             the secret, and the row is then absent.
 */
import { Router } from 'express';

import { authMiddleware } from '../auth/middleware.js';
import { recordDrift, getDriftReports } from '../driftStore.js';
import { DRIFT_LIMITS, validateReport } from '../driftReports.js';
import { envValue } from '../env.js';
import { apiError } from '../errors.js';
import { secretOk } from '../util/secretAuth.js';

const router = Router();

router.post('/report', (req, res) => {
  // Same guard as the cron report: false when no secret is set (endpoint off).
  // A string only: secretOk stringifies, so a one-element list would otherwise match.
  const sent = req.body?.secret;
  if (typeof sent !== 'string' || !secretOk(envValue('JAGHELM_CRON_SECRET'), sent)) {
    return apiError(res, 401, 'Unauthorized');
  }
  const declared = Number(req.headers['content-length']);
  if (declared > DRIFT_LIMITS.bodyBytes || JSON.stringify(req.body).length > DRIFT_LIMITS.bodyBytes) {
    return apiError(res, 413, 'Report too large');
  }
  const checked = validateReport(req.body);
  if (!checked.ok) return apiError(res, checked.status, checked.error);
  const result = recordDrift(checked.report);
  if (result === 'full') return apiError(res, 413, `At most ${DRIFT_LIMITS.hosts} hosts report`);
  // A report checked earlier than the stored one is ignored, not an error.
  res.json(result === 'older' ? { ok: true, stale: true } : { ok: true });
});

router.get('/', authMiddleware, (req, res) => {
  const configured = Boolean(envValue('JAGHELM_CRON_SECRET'));
  // `now` is the server's, so the age a client draws never rests on its own clock.
  const body = configured
    ? { configured, now: new Date().toISOString(), reports: getDriftReports() }
    : { configured };
  res.set('Cache-Control', 'no-store');
  res.json(body);
});

export { router as driftRoutes };
