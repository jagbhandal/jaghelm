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

const router = Router();

router.get('/', async (req, res) => {
  const cached = getCached('services');
  if (cached) return jsonWithEtag(res, req, 'services', cached);

  // Cold start — refresh inline once
  const data = await refreshServices();
  if (data) return jsonWithEtag(res, req, 'services', data);

  return apiError(res, 503, 'Service data not yet available');
});

router.get('/config', (req, res) => {
  res.json(getConfig() || {});
});

router.post('/config', (req, res) => {
  const newConfig = req.body;
  if (!newConfig || typeof newConfig !== 'object') {
    return apiError(res, 400, 'Invalid config');
  }
  const ok = saveConfig(newConfig);
  res.json({ ok });
});

router.get('/monitors', async (req, res) => {
  const names = await getMonitorNames();
  res.json(names);
});

export { router as servicesRoutes };
