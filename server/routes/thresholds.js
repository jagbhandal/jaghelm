/**
 * The threshold lines Settings → Notifications edits (#320, spec §6.1, §7).
 *
 *   GET /api/thresholds → { thresholds: [{ metric, unit, warn, crit,
 *                         defaults: { warn, crit }, min, max, band, custom }] },
 *                         CPU, memory, disk, temperature and the NVMe and SATA drive
 *                         temperatures (nvmeTemp, sataTemp) in that order,
 *                         the lines in force in percent and °C (crit null for
 *                         a metric with none), with thresholds.json's version
 *                         as the ETag
 *   PUT /api/thresholds → save a table, only over the version in If-Match:
 *                         { cpu, mem, disk, temp, nvmeTemp, sataTemp }, each { warn, crit?, unit }
 *                         or null for its defaults (a metric left out is its
 *                         defaults too); answers as the GET does
 *
 * Saved to thresholds.json (thresholdsFile.js) with the write discipline of
 * the other config files (#423, #547, util/fileVersion.js): the version is an
 * HMAC of the file's bytes; a save that names none is a 428, one over a
 * version that is no longer the file's (another device saved, or a hand
 * edit) a 409 with the version now; the check and the atomic write are one
 * synchronous step. A table it refuses is a 400 saying why, with the metric
 * it is about (`metric`): an unknown metric, a unit that isn't the metric's
 * (% or °C), a line out of range, a warning line not under its critical one
 * (status/thresholdTable.js). The refresh loop reads the file every cycle, so
 * the status model, and push with it, judge by a save from the next cycle.
 *
 * While there is no thresholds.json, the lines in force are
 * display-config.json's `pushThresholds` over the defaults, and that is what
 * the GET shows; the first save replaces them (status/thresholds.js).
 *
 * A thresholds.json that doesn't parse, or holds a line a save would refuse,
 * is a 503 `config_unparseable` saying why, with its version as the ETag, so
 * a save over that version rewrites it; one that can't be read is a 503
 * `config_unreadable`, and nothing is saved over it. Behind the token like
 * every /api route (index.js).
 */
import { Router } from 'express';

import { readDisplayConfig, thresholdsOf } from '../refresh.js';
import { apiError, CONFIG_UNPARSEABLE, CONFIG_UNREADABLE, configUnusable } from '../errors.js';
import { DEFAULT_THRESHOLDS } from '../status/thresholds.js';
import { readThresholdTable, savedTable, thresholdView } from '../status/thresholdTable.js';
import {
  invalidateSavedThresholds,
  parseSavedThresholds,
  THRESHOLDS_PATH,
} from '../thresholdsFile.js';
import { atomicWriteFileSync } from '../util/atomicWrite.js';
import {
  etagOf,
  ifMatchHits,
  readErrorWords,
  readVersioned,
  refuseStale,
  versionNamed,
  versionOf,
} from '../util/fileVersion.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('thresholds');

/** Why a thresholds.json that is there can't be read, never its path. */
const unreadable = (err) =>
  `thresholds.json can't be read (${readErrorWords(err)}): fix it on the host; ` +
  "JagHelm won't save over a file it can't read";

/** The answer for these saved lines (null: none, so pushThresholds counts). */
function answer(saved) {
  const inForce = thresholdsOf(readDisplayConfig(), saved);
  return { thresholds: thresholdView(inForce, DEFAULT_THRESHOLDS) };
}

const router = Router();

router.get('/', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const disk = readVersioned(THRESHOLDS_PATH);
    if (disk.readError) {
      log.error({ err: disk.readError }, 'Failed to read');
      return configUnusable(res, unreadable(disk.readError), CONFIG_UNREADABLE);
    }
    res.set('ETag', etagOf(disk.version));
    if (!disk.bytes) return res.json(answer(null));
    const parsed = parseSavedThresholds(disk.bytes);
    if ('unusable' in parsed) return configUnusable(res, parsed.unusable, CONFIG_UNPARSEABLE);
    return res.json(answer(parsed.lines));
  } catch (err) {
    return apiError(res, 500, 'Failed to read the thresholds', err);
  }
});

// Synchronous from the read to the write: no other request can write the
// file after the version check.
router.put('/', (req, res) => {
  try {
    const read = readThresholdTable(req.body);
    if ('error' in read) {
      return res
        .status(400)
        .json({ error: read.error, ...(read.metric ? { metric: read.metric } : {}) });
    }
    const ifMatch = versionNamed(
      req,
      res,
      'The save named no thresholds version (If-Match); reload the page'
    );
    if (ifMatch == null) return undefined;

    const disk = readVersioned(THRESHOLDS_PATH);
    if (disk.readError) {
      log.warn({ err: disk.readError }, "thresholds.json can't be read; not saving over it");
      return configUnusable(res, unreadable(disk.readError), CONFIG_UNREADABLE);
    }
    if (!ifMatchHits(ifMatch, disk.version)) {
      return refuseStale(
        res,
        'The thresholds changed since this page read them; read them again',
        disk.version
      );
    }

    const table = savedTable(read.lines, DEFAULT_THRESHOLDS);
    const serialized = `${JSON.stringify(table, null, 2)}\n`;
    atomicWriteFileSync(THRESHOLDS_PATH, serialized);
    invalidateSavedThresholds();
    log.info({ custom: Object.keys(table) }, 'thresholds saved');
    res.set('ETag', etagOf(versionOf(serialized)));
    return res.json(answer(read.lines));
  } catch (err) {
    return apiError(res, 500, 'Failed to save the thresholds', err);
  }
});

export { router as thresholdsRoutes };
