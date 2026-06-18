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
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { restartBackgroundRefresh, invalidateRefreshIntervalCache } from '../refresh.js';
import { apiError } from '../errors.js';
import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { validateConfig, displayConfigSchema } from '../util/configSchema.js';
import { DATA_DIR } from '../util/dataDir.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('display-config');

// Honor JAGHELM_DATA_DIR like every other store (secrets/auth/services.yaml)
// so tests stay isolated and a containerized deploy can relocate state.
const DISPLAY_CONFIG_PATH = join(DATA_DIR, 'display-config.json');

const router = Router();

router.get('/', (req, res) => {
  try {
    if (existsSync(DISPLAY_CONFIG_PATH)) {
      const data = JSON.parse(readFileSync(DISPLAY_CONFIG_PATH, 'utf8'));
      return res.json(data);
    }
    res.json(null);
  } catch (err) {
    log.error({ err }, 'Failed to read');
    res.json(null);
  }
});

router.post('/', (req, res) => {
  try {
    const v = validateConfig(displayConfigSchema, req.body);
    if (!v.ok) return apiError(res, v.status, v.error);
    const config = v.data;
    const serialized = JSON.stringify(config, null, 2);

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

    atomicWriteFileSync(DISPLAY_CONFIG_PATH, serialized);
    // Always invalidate — even if the interval value happens to match, the
    // cache could be stale from a previous run. Restart re-reads through
    // getRefreshIntervalMs which now hits a fresh cache slot.
    invalidateRefreshIntervalCache();
    if (intervalChanged) restartBackgroundRefresh();
    res.json({ ok: true });
  } catch (err) {
    apiError(res, 500, 'Failed to save display config', err);
  }
});

export { router as displayConfigRoutes };
