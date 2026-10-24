/**
 * The guided first run's state (#322, spec §8; server/setup.js).
 *
 *   GET  /api/setup       → { pending: boolean }: whether this install still
 *                           has its guided setup to go through
 *   POST /api/setup/done  → Finish or Skip: clears it for every device;
 *                           answers { pending: false }
 *
 * Behind the token like every /api route (index.js).
 */
import { Router } from 'express';

import { apiError } from '../errors.js';
import { finishSetup, setupPending } from '../setup.js';

const router = Router();

router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ pending: setupPending() });
});

router.post('/done', (req, res) => {
  if (!finishSetup()) return apiError(res, 500, "Couldn't save that setup is done");
  res.set('Cache-Control', 'no-store');
  return res.json({ pending: false });
});

export { router as setupRoutes };
