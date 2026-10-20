/**
 * Services routes — the dashboard's primary data feed plus config CRUD.
 *
 *   GET  /api/services           → unified node + container + monitor payload
 *   GET  /api/services/config    → services.yaml as JSON, without its credentials
 *   POST /api/services/config    → replace services.yaml, keeping stored credentials
 *   GET  /api/services/monitors  → flat list of Kuma monitor names
 *
 * The /api/services payload is kept warm by the background refresh loop;
 * the route reads from cache and falls back to an on-demand refresh on a
 * cold start.
 *
 * The config read never carries a credential (#413): each one that is set
 * comes back as { "$stored": true }, and the write puts the stored value back
 * in each marker's place (util/configMask.js). Settings' Nodes and
 * Services tabs read the config, change it and post the whole of it back, so
 * an unchanged credential round-trips as its marker.
 */

import { isDeepStrictEqual } from 'node:util';

import { Router } from 'express';

import { getConfig, saveConfig } from '../config.js';
import { getMonitorNames } from '../monitors.js';
import { refreshServices } from '../refresh.js';
import { respondWarmCached } from '../cache.js';
import { apiError } from '../errors.js';
import { asyncHandler } from '../util/asyncHandler.js';
import { validateConfig, servicesConfigSchema } from '../util/configSchema.js';
import { maskCredentials, restoreCredentials } from '../util/configMask.js';

const router = Router();

router.get(
  '/',
  asyncHandler((req, res) =>
    respondWarmCached(req, res, {
      key: 'services',
      refresh: refreshServices,
      fallback: (r) => apiError(r, 503, 'Service data not yet available'),
    })
  )
);

router.get('/config', (req, res) => {
  res.json(maskCredentials(getConfig() || {}));
});

router.post('/config', (req, res) => {
  const v = validateConfig(servicesConfigSchema, req.body);
  if (!v.ok) return apiError(res, v.status, v.error);

  // Each marker becomes the credential stored in its place. One where nothing
  // is stored, or in place of anything but a credential, is refused, so a
  // marker is never written and no credential moves to another place.
  const current = getConfig();
  const restored = restoreCredentials(v.data, current || {});
  if (!restored.ok) return apiError(res, restored.status, restored.error);

  // A save that changes nothing writes nothing, so services.yaml stays
  // byte-for-byte as it was (every write re-serialises the whole file), as an
  // unchanged integration save (#402).
  if (current && isDeepStrictEqual(restored.config, current)) return res.json({ ok: true });

  const ok = saveConfig(restored.config);
  // saveConfig returns false on a write failure (or a reentrant save) — surface
  // that as a 500 instead of a misleading HTTP 200 { ok: false }.
  if (!ok) return apiError(res, 500, 'Failed to persist config');
  res.json({ ok: true });
});

router.get(
  '/monitors',
  asyncHandler(async (req, res) => {
    const names = await getMonitorNames();
    res.json(names);
  })
);

export { router as servicesRoutes };
