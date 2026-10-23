/**
 * Secrets API — manage encrypted credentials in data/secrets.json.
 *
 *   GET    /api/secrets/keys     → list of key names (never values)
 *   PUT    /api/secrets/:key     → encrypt and store { value, url? }
 *   DELETE /api/secrets/:key     → remove a key
 *
 * A secret goes only to the address it was entered for (#556): one stored
 * here with a `url` may be sent to that URL's origin only, and one stored
 * without goes nowhere until it is entered in an integration's form. A new
 * value replaces the origins the name had. The origins are never answered.
 */

import { Router } from 'express';

import { setSecret, deleteSecret, listSecretKeys, NO_KEY_ERROR } from '../secrets.js';
import { apiError } from '../errors.js';
import { originOf } from '../integrations/lib/origin.js';

const router = Router();

router.get('/keys', (req, res) => {
  res.json(listSecretKeys());
});

const KEY_RE = /^[\w.-]{1,128}$/; // letters/digits/_/./- ; bounds the stored identifier
const MAX_VALUE_BYTES = 8 * 1024; // credentials/tokens are short; cap to bound the store

router.put('/:key', (req, res) => {
  const { key } = req.params;
  const { value, url } = req.body || {};
  if (!KEY_RE.test(key || '')) {
    return apiError(res, 400, 'Invalid secret key (letters, digits, . _ - only; max 128)');
  }
  if (typeof value !== 'string' || value.length === 0) return apiError(res, 400, 'Missing value');
  if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
    return apiError(res, 413, 'Secret value too large (max 8KB)');
  }

  const origin = url === undefined ? null : originOf(url);
  if (url !== undefined && !origin) return apiError(res, 400, 'url must be an http(s) URL');

  const ok = setSecret(key, value, { origins: origin ? [origin] : [] });
  if (!ok) return apiError(res, 500, NO_KEY_ERROR);
  res.json({ ok: true, key });
});

router.delete('/:key', (req, res) => {
  const ok = deleteSecret(req.params.key);
  res.json({ ok, key: req.params.key });
});

export { router as secretsRoutes };
