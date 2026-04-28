/**
 * Secrets API — manage encrypted credentials in data/secrets.json.
 *
 *   GET    /api/secrets/keys     → list of key names (never values)
 *   PUT    /api/secrets/:key     → encrypt and store { value }
 *   DELETE /api/secrets/:key     → remove a key
 */

import { Router } from 'express';

import { setSecret, deleteSecret, listSecretKeys } from '../secrets.js';
import { apiError } from '../errors.js';

const router = Router();

router.get('/keys', (req, res) => {
  res.json(listSecretKeys());
});

router.put('/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body || {};
  if (!value) return apiError(res, 400, 'Missing value');

  const ok = setSecret(key, value);
  if (!ok) return apiError(res, 500, 'Secrets manager not initialized (DASH_SECRET missing?)');
  res.json({ ok: true, key });
});

router.delete('/:key', (req, res) => {
  const ok = deleteSecret(req.params.key);
  res.json({ ok, key: req.params.key });
});

export { router as secretsRoutes };
