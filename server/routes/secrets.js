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

const KEY_RE = /^[\w.-]{1,128}$/; // letters/digits/_/./- ; bounds the stored identifier
const MAX_VALUE_BYTES = 8 * 1024; // credentials/tokens are short; cap to bound the store

router.put('/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body || {};
  if (!KEY_RE.test(key || '')) {
    return apiError(res, 400, 'Invalid secret key (letters, digits, . _ - only; max 128)');
  }
  if (typeof value !== 'string' || value.length === 0) return apiError(res, 400, 'Missing value');
  if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
    return apiError(res, 413, 'Secret value too large (max 8KB)');
  }

  const ok = setSecret(key, value);
  if (!ok) return apiError(res, 500, 'Secrets manager not initialized (DASH_SECRET missing?)');
  res.json({ ok: true, key });
});

router.delete('/:key', (req, res) => {
  const ok = deleteSecret(req.params.key);
  res.json({ ok, key: req.params.key });
});

export { router as secretsRoutes };
