/**
 * Services routes — the dashboard's primary data feed plus config CRUD.
 *
 *   GET  /api/services           → unified node + container + monitor payload
 *   GET  /api/services/config    → raw services.yaml as JSON
 *   POST /api/services/config    → replace services.yaml
 *   GET  /api/services/monitors  → flat list of Kuma monitor names
 *
 * The /api/services payload is kept warm by the background refresh loop;
 * the route reads from cache and falls back to an on-demand refresh on a
 * cold start.
 */

import { Router } from 'express';

import { getConfig, saveConfig } from '../config.js';
import { getMonitorNames } from '../monitors.js';
import { refreshServices } from '../refresh.js';
import { getCached, jsonWithEtag } from '../cache.js';
import { apiError } from '../errors.js';
import { asyncHandler } from '../util/asyncHandler.js';
import { validateConfig, servicesConfigSchema } from '../util/configSchema.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const cached = getCached('services');
    if (cached) return jsonWithEtag(res, req, 'services', cached);

    // Cold start — refresh inline once
    const data = await refreshServices();
    if (data) return jsonWithEtag(res, req, 'services', data);

    return apiError(res, 503, 'Service data not yet available');
  })
);

router.get('/config', (req, res) => {
  res.json(getConfig() || {});
});

router.post('/config', (req, res) => {
  const v = validateConfig(servicesConfigSchema, req.body);
  if (!v.ok) return apiError(res, v.status, v.error);

  const ok = saveConfig(v.data);
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
