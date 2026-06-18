import { Router } from 'express';
import { createHash, timingSafeEqual } from 'crypto';

import { authMiddleware } from '../auth/middleware.js';
import { recordRun, getAllStatuses } from '../cron-store.js';
import { apiError } from '../errors.js';

const router = Router();

/**
 * Constant-time string comparison via SHA-256 digests.
 * Inputs are hashed to fixed 32-byte buffers, so the comparison is constant-time
 * with respect to both content and length. Plain `===` or `!==` short-circuits
 * on the first mismatched byte, leaking the secret one character at a time
 * over many requests.
 */
function constantTimeEquals(a, b) {
  const hashA = createHash('sha256').update(String(a)).digest();
  const hashB = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(hashA, hashB);
}

router.post('/report', (req, res) => {
  const secret = process.env.JAGHELM_CRON_SECRET || '';
  const provided = req.body?.secret || '';

  // No secret configured = endpoint effectively disabled. Bail before doing
  // any comparison work so an unconfigured server can't be brute-forced.
  if (!secret) {
    return apiError(res, 401, 'Unauthorized');
  }

  if (!constantTimeEquals(secret, provided)) {
    return apiError(res, 401, 'Unauthorized');
  }

  const { job, node, status, duration_seconds, schedule, error } = req.body;
  if (!job || !node || !['success', 'failure'].includes(status)) {
    return apiError(res, 400, 'Missing required fields: job, node, status');
  }
  // Bound the stored string fields so the cron history can't be bloated, and
  // coerce duration to a finite number (it flows into stored stats).
  const over = (v, n) => typeof v === 'string' && v.length > n;
  if (over(job, 256) || over(node, 256) || over(schedule, 256) || over(error, 2048)) {
    return apiError(res, 413, 'Field too long');
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
  });
  res.json({ ok: true });
});

router.get('/status', authMiddleware, (req, res) => {
  res.json(getAllStatuses());
});

export { router as cronRoutes };
