import { Router } from 'express';

import { authMiddleware } from '../auth/middleware.js';
import { parseExpectedEvery, decorateStatuses } from '../cron-overdue.js';
import { recordRun, getAllStatuses, deleteJob } from '../cron-store.js';
import { envValue } from '../env.js';
import { apiError } from '../errors.js';
import { secretOk } from '../util/secretAuth.js';

const router = Router();

// A browser rewrites a path segment of "." or ".." before it sends it (#578),
// so a job or node of that name could never be removed: refused.
const DOT_NAMES = ['.', '..'];
const DOT_ERROR = 'job and node must not be "." or ".."';

router.post('/report', (req, res) => {
  // secretOk returns false when no secret is configured (endpoint disabled) and
  // otherwise does a constant-time compare — same two-step guard, one call.
  if (!secretOk(envValue('JAGHELM_CRON_SECRET'), req.body?.secret)) {
    return apiError(res, 401, 'Unauthorized');
  }

  const { job, node, status, duration_seconds, schedule, error } = req.body;
  if (
    typeof job !== 'string' ||
    typeof node !== 'string' ||
    typeof status !== 'string' ||
    !job ||
    !node ||
    !['success', 'failure'].includes(status)
  ) {
    return apiError(res, 400, 'Missing required fields: job, node, status');
  }
  const RESERVED = ['__proto__', 'constructor', 'prototype'];
  if (RESERVED.includes(job) || RESERVED.includes(node)) {
    return apiError(res, 400, 'job and node must not be a reserved name');
  }
  if (DOT_NAMES.includes(job) || DOT_NAMES.includes(node)) {
    return apiError(res, 400, DOT_ERROR);
  }
  // Bound the stored string fields so the cron history can't be bloated, and
  // coerce duration to a finite number (it flows into stored stats).
  const over = (v, n) => typeof v === 'string' && v.length > n;
  if (over(job, 256) || over(node, 256) || over(schedule, 256) || over(error, 2048)) {
    return apiError(res, 413, 'Field too long');
  }
  const expected = parseExpectedEvery(req.body.expected_every_seconds);
  if (!expected.ok) {
    return apiError(res, 400, 'expected_every_seconds must be an integer from 60 to 2678400');
  }
  const dur = Number(duration_seconds);

  recordRun({
    job,
    node,
    status,
    duration_seconds: Number.isFinite(dur) ? dur : 0,
    // Only persist string fields as strings — a non-string can't slip the cap.
    schedule: typeof schedule === 'string' ? schedule : undefined,
    error: typeof error === 'string' ? error : undefined,
    expected_every_seconds: expected.value,
  });
  res.json({ ok: true });
});

// seconds_since_report changes every second, so an ETag would never match.
// Instead the response may be reused for a minute: overdue has at least 10
// minutes' grace, and the web dashboard reads cron every few ticks anyway.
router.get('/status', authMiddleware, (req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  res.json(decorateStatuses(getAllStatuses(), Date.now()));
});

router.delete('/jobs/:node/:job', authMiddleware, (req, res) => {
  if (DOT_NAMES.includes(req.params.node) || DOT_NAMES.includes(req.params.job)) {
    return apiError(res, 400, DOT_ERROR);
  }
  if (!deleteJob(req.params.node, req.params.job)) {
    return apiError(res, 404, 'Job not found');
  }
  res.status(204).end();
});

export { router as cronRoutes };
