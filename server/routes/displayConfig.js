/**
 * Display configuration — UI settings persisted server-side.
 *
 *   GET  /api/display-config → current config object (or null)
 *   POST /api/display-config → replace config; restarts the background
 *                              refresh loop if the interval changed
 *
 * Stored as data/display-config.json. The frontend keeps a localStorage
 * shadow for instant load; the server is authoritative.
 */

import { Router } from 'express';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { restartBackgroundRefresh } from '../refresh.js';
import { apiError } from '../errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DISPLAY_CONFIG_PATH = join(__dirname, '..', '..', 'data', 'display-config.json');
const MAX_BYTES = 1_048_576;

const router = Router();

router.get('/', (req, res) => {
  try {
    if (existsSync(DISPLAY_CONFIG_PATH)) {
      const data = JSON.parse(readFileSync(DISPLAY_CONFIG_PATH, 'utf8'));
      return res.json(data);
    }
    res.json(null);
  } catch (err) {
    console.error('[display-config] Failed to read:', err.message);
    res.json(null);
  }
});

router.post('/', (req, res) => {
  try {
    const config = req.body;
    if (!config || typeof config !== 'object') {
      return apiError(res, 400, 'Invalid config');
    }
    const serialized = JSON.stringify(config, null, 2);
    if (serialized.length > MAX_BYTES) {
      return apiError(res, 413, 'Config too large (max 1MB)');
    }

    // Did the refresh interval change? If so, restart the loop after writing.
    let intervalChanged = false;
    try {
      if (existsSync(DISPLAY_CONFIG_PATH)) {
        const old = JSON.parse(readFileSync(DISPLAY_CONFIG_PATH, 'utf8'));
        if (old?.refreshInterval !== config?.refreshInterval) intervalChanged = true;
      } else {
        intervalChanged = true;
      }
    } catch {
      intervalChanged = true;
    }

    writeFileSync(DISPLAY_CONFIG_PATH, serialized);
    if (intervalChanged) restartBackgroundRefresh();
    res.json({ ok: true });
  } catch (err) {
    apiError(res, 500, 'Failed to save display config', err);
  }
});

export { router as displayConfigRoutes };
