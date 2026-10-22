/**
 * Display configuration — UI settings persisted server-side.
 *
 *   GET  /api/display-config → current config object (or null), with its
 *                              version as the ETag; a 304 for an
 *                              If-None-Match that names it
 *   POST /api/display-config → replace config, only over the version in
 *                              If-Match; restarts the background refresh loop
 *                              if the interval changed
 *
 * Stored as data/display-config.json. The frontend keeps a localStorage
 * shadow for instant load; the server is authoritative.
 *
 * A save needs the version the device read (#547), as a services.yaml save
 * does (#423), by the same mechanism (util/fileVersion.js): the version is an
 * HMAC-SHA256 of the file's bytes on disk with the per-install key, a missing
 * file's is VERSION_ABSENT, and the read's ETag is that version, nothing
 * else. A save that names none is a 428; one over a version that is no longer
 * the file's (another device saved, or a hand edit) is a 409 with the version
 * now; nothing is written either way. The check and the write are one
 * synchronous step. A save answers with the version it wrote.
 *
 * The read leaves out a stored value the save would refuse (a hand edit that
 * breaks the schema), warning once per version of the file with the key,
 * never the value: a device saves back what it read, so the value would
 * otherwise refuse every save from Settings. The next save writes the file
 * without it.
 */

import { Router } from 'express';
import { join } from 'path';

import { ifNoneMatchHits } from '../cache.js';
import { restartBackgroundRefresh, invalidateDisplayConfigCache } from '../refresh.js';
import { apiError } from '../errors.js';
import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { validateConfig, displayConfigSchema } from '../util/configSchema.js';
import { DATA_DIR } from '../util/dataDir.js';
import {
  etagOf,
  ifMatchHits,
  readVersioned,
  refuseStale,
  versionNamed,
  versionOf,
} from '../util/fileVersion.js';
import { createLogger } from '../util/logger.js';
import { jsonFileErrorFields } from '../util/parseError.js';

const log = createLogger('display-config');

// Honor JAGHELM_DATA_DIR like every other store (secrets/auth/services.yaml)
// so tests stay isolated and a containerized deploy can relocate state.
const DISPLAY_CONFIG_PATH = join(DATA_DIR, 'display-config.json');

// The settings the schema checks, each with its own rule.
const FIELDS = displayConfigSchema.shape;
// The version of the file whose refused values were last warned about.
let warnedVersion = null;

const router = Router();

/**
 * The stored config as a device reads it: the file's JSON (null when it
 * doesn't parse, logged with its reason and position, never its text, #504),
 * without any setting whose value the schema refuses.
 */
function storedConfig(bytes, version) {
  let data;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    log.error(jsonFileErrorFields(err), 'Failed to read');
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const refused = Object.keys(FIELDS).filter(
    (key) => Object.hasOwn(data, key) && !FIELDS[key].safeParse(data[key]).success
  );
  if (refused.length === 0) return data;
  if (warnedVersion !== version) {
    warnedVersion = version;
    log.warn(
      { keys: refused },
      `display-config.json has settings no save would take (${refused.join(', ')}); ` +
        'left out of what devices read, so the next save drops them'
    );
  }
  const out = { ...data };
  for (const key of refused) delete out[key];
  return out;
}

/** Whether `interval` differs from the stored one (bytes null: no file). */
function intervalChangedFrom(bytes, interval) {
  if (!bytes) return true;
  try {
    return JSON.parse(bytes.toString('utf8'))?.refreshInterval !== interval;
  } catch {
    return true;
  }
}

router.get('/', (req, res) => {
  try {
    const disk = readVersioned(DISPLAY_CONFIG_PATH);
    if (disk.readError) {
      log.error({ err: disk.readError }, 'Failed to read');
      return res.json(null);
    }
    const etag = etagOf(disk.version);
    res.set('ETag', etag);
    if (ifNoneMatchHits(req.get('If-None-Match'), etag)) return res.status(304).end();
    res.json(disk.bytes ? storedConfig(disk.bytes, disk.version) : null);
  } catch (err) {
    apiError(res, 500, 'Failed to read display config', err);
  }
});

// Synchronous from the read to the write: no other request can write the
// file after the version check.
router.post('/', (req, res) => {
  try {
    const v = validateConfig(displayConfigSchema, req.body);
    if (!v.ok) return apiError(res, v.status, v.error);
    const ifMatch = versionNamed(
      req,
      res,
      'The save named no display-config version (If-Match); reload the page'
    );
    if (ifMatch == null) return;

    const disk = readVersioned(DISPLAY_CONFIG_PATH);
    if (disk.readError) {
      return apiError(
        res,
        503,
        "display-config.json can't be read; fix it on the host",
        disk.readError
      );
    }
    if (!ifMatchHits(ifMatch, disk.version)) {
      return refuseStale(
        res,
        'The display settings changed since this device read them; read them again',
        disk.version
      );
    }

    const config = v.data;
    const serialized = JSON.stringify(config, null, 2);
    // Did the refresh interval change? If so, restart the loop after writing.
    const intervalChanged = intervalChangedFrom(disk.bytes, config?.refreshInterval);

    atomicWriteFileSync(DISPLAY_CONFIG_PATH, serialized);
    // Always invalidate, even if the interval is unchanged: the push thresholds
    // may have changed, and the loop's file-identity check misses a quick
    // second save that reuses the inode, size and mtime. Restart re-reads the
    // interval through the now-empty cache.
    invalidateDisplayConfigCache();
    if (intervalChanged) restartBackgroundRefresh();
    res.set('ETag', etagOf(versionOf(serialized)));
    res.json({ ok: true });
  } catch (err) {
    apiError(res, 500, 'Failed to save display config', err);
  }
});

export { router as displayConfigRoutes };
