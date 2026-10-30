/**
 * The one-time units migration (#322). Before the `units` setting, the web
 * app drew temperatures in Fahrenheit unless `tempUnit` said 'C', and nothing
 * wrote `tempUnit` until the control was touched. So an existing
 * display-config.json with neither key means Fahrenheit, and keeps meaning it:
 * at boot it gets `units: 'imperial'` (a stored `tempUnit` of 'C' becomes
 * 'metric', 'F' 'imperial'). A file that already has `units` is never
 * touched, nor one that doesn't parse (the routes report it), and with no file
 * (a fresh install) nothing is written: the web app's own default, metric,
 * stands. Idempotent: the second run finds `units` and does nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFileSync } from './util/atomicWrite.js';
import { DATA_DIR } from './util/dataDir.js';
import { createLogger } from './util/logger.js';

const log = createLogger('config');

/**
 * The unit the status model writes temperatures in (#494): the display
 * config's `units`, 'metric' (°C) by default (Jag, #494). A config from before
 * the setting that still says `tempUnit: 'F'` is Fahrenheit, as the migration
 * below would save it. /api/status serves the answer (`units`), and the web
 * draws its meters by that, so a reason and a meter never differ.
 *
 * @param {any} config  display-config.json, parsed
 * @returns {'metric' | 'imperial'}
 */
export function unitsOfConfig(config) {
  if (config?.units === 'metric' || config?.units === 'imperial') return config.units;
  return config?.tempUnit === 'F' ? 'imperial' : 'metric';
}

/** @returns {'migrated' | 'none'} */
export function migrateDisplayUnits() {
  const path = join(DATA_DIR, 'display-config.json');
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return 'none'; // no file, or one that doesn't parse
  }
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return 'none';
  if (Object.hasOwn(cfg, 'units')) return 'none';
  const units = cfg.tempUnit === 'C' ? 'metric' : 'imperial';
  try {
    atomicWriteFileSync(path, JSON.stringify({ ...cfg, units }, null, 2));
  } catch (err) {
    log.warn({ err: err?.message }, "display-config.json: couldn't save the units setting");
    return 'none';
  }
  log.info(
    { units },
    'display-config.json had no units setting: saved the one it was drawing (Fahrenheit unless tempUnit was C)'
  );
  return 'migrated';
}
