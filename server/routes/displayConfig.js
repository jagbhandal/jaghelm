/**
 * Display configuration — UI settings persisted server-side.
 *
 *   GET  /api/display-config → current config object (or null when there is
 *                              no file), with its version as the ETag; a 304
 *                              for an If-None-Match that names it
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
 * A file that is no config is never answered as one, so no device lays its
 * own changes over an empty copy and saves a config without the rest:
 *  - one that doesn't parse, or isn't a JSON object, is a 503
 *    `config_unparseable` saying why (its reason and position, never its
 *    text, #504), with the file's version as the ETag: a device saves its
 *    whole copy over that version, which rewrites the file;
 *  - one that can't be read is a 503 `config_unreadable` with no version, and
 *    a save is refused the same way: fix it on the host.
 *
 * A save that adds or changes a custom theme (`themes`, #331) is refused with a
 * 400 naming the pairing it breaks if the theme fails the contrast rules
 * (server/themes.js); a theme already in the file is kept as it is, so a
 * config with a hand-edited bad theme can still be saved, to remove it.
 *
 * The read leaves out each stored value a save would refuse (a hand edit),
 * at the depth it is refused: a reserved key (`__proto__`) or an unsafe link
 * `url` (scanConfig: the link that holds it goes, the other links stay), or
 * a value the schema refuses (one `overviewSections` entry, not the map). It
 * warns once per version of the file with each path, never the value. A
 * device saves back what it read, so the value would otherwise refuse every
 * save from Settings; the next save writes the file without it.
 */

import { Router } from 'express';
import { join } from 'path';

import { ifNoneMatchHits } from '../cache.js';
import { restartBackgroundRefresh, invalidateDisplayConfigCache } from '../refresh.js';
import { apiError, CONFIG_UNPARSEABLE, CONFIG_UNREADABLE, configUnusable } from '../errors.js';
import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { themesSaveError } from '../themes.js';
import {
  displayConfigSchema,
  diskForecastDaysSchema,
  expirySchema,
  findViolations,
  nodeOrderSchema,
  validateConfig,
} from '../util/configSchema.js';
import { EXPIRY_LIMITS } from '../expiryTargets.js';
import { sanitizeAlerts } from '../push/alertRules.js';
import { DATA_DIR } from '../util/dataDir.js';
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
import { describeParseError, jsonFileErrorFields, jsonParseError } from '../util/parseError.js';

const log = createLogger('display-config');

// Honor JAGHELM_DATA_DIR like every other store (secrets/auth/services.yaml)
// so tests stay isolated and a containerized deploy can relocate state.
const DISPLAY_CONFIG_PATH = join(DATA_DIR, 'display-config.json');

// The version of the file whose refused values were last warned about.
let warnedVersion = null;

// Rounds of dropping and checking again: dropping a value can't make a new
// refusal, so one more round than the deepest nesting is never needed.
const HEAL_ROUNDS = 8;

const router = Router();

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const expiryDaysOk = (v) => Number.isInteger(v) && v >= EXPIRY_LIMITS.min && v <= EXPIRY_LIMITS.max;

/** A path as the warning names it: `links.Media[1]`, `overviewSections.rail`. */
const pathText = (path) =>
  path.map((k, i) => (typeof k === 'number' ? `[${k}]` : i ? `.${k}` : k)).join('');

// What drop() leaves in an array in place of an element, filtered out after.
const DROPPED = Symbol('dropped');

/** Drop the value at `path` from `root`; false when there is nothing there. */
function drop(root, path) {
  let parent = root;
  for (const key of path.slice(0, -1)) {
    parent = parent?.[key];
    if (parent === null || typeof parent !== 'object' || parent === DROPPED) return false;
  }
  const key = path.at(-1);
  if (!Object.hasOwn(parent, key) || parent[key] === DROPPED) return false;
  if (Array.isArray(parent)) parent[key] = DROPPED;
  else delete parent[key];
  return true;
}

/** `value` without the array elements drop() left. */
function withoutDropped(value) {
  if (Array.isArray(value)) return value.filter((v) => v !== DROPPED).map(withoutDropped);
  if (!isObject(value)) return value;
  for (const key of Object.keys(value)) value[key] = withoutDropped(value[key]);
  return value;
}

/**
 * `data` (freshly parsed, so changed in place) without each value a save
 * would refuse, at its depth, and the paths dropped. An unsafe `url` drops
 * the object that holds it (the link, the tab); a reserved key drops itself;
 * a schema refusal drops the value it names.
 */
function healed(data) {
  const dropped = [];
  for (let round = 0; round < HEAL_ROUNDS; round++) {
    const paths = findViolations(data).map((v) =>
      v.kind === 'url' && v.path.length > 1 ? v.path.slice(0, -1) : v.path
    );
    if (paths.length === 0) {
      const parsed = displayConfigSchema.safeParse(data);
      if (parsed.success) break;
      for (const issue of parsed.error.issues) {
        if (issue.path.length > 0) paths.push(/** @type {(string|number)[]} */ (issue.path));
      }
    }
    let any = false;
    for (const path of paths) {
      if (drop(data, path)) {
        dropped.push(path);
        any = true;
      }
    }
    data = withoutDropped(data);
    if (!any) break;
  }
  // The schema reads a bad nodeOrder as unset (so a save is never refused over
  // it); the read leaves it out too, so no device sees a value that is no order.
  if (isObject(data) && Object.hasOwn(data, 'nodeOrder')) {
    const order = nodeOrderSchema.safeParse(data.nodeOrder);
    if (order.success) {
      // Over-long keys are dropped from the list (the schema's rule), not the list.
      if (order.data.length !== data.nodeOrder.length) data = { ...data, nodeOrder: order.data };
    } else {
      delete data.nodeOrder;
      dropped.push(['nodeOrder']);
    }
  }
  // `alerts` (#669) is read as the parts of it that are valid, a bad part its default.
  if (isObject(data) && Object.hasOwn(data, 'alerts')) {
    const kept = sanitizeAlerts(data.alerts);
    if (kept === undefined) delete data.alerts;
    else data.alerts = kept;
  }
  // The same for the disk forecast's lines (#670).
  if (
    isObject(data) &&
    Object.hasOwn(data, 'diskForecastDays') &&
    !diskForecastDaysSchema.safeParse(data.diskForecastDays).success
  ) {
    delete data.diskForecastDays;
    dropped.push(['diskForecastDays']);
  }
  // The expiry tracker's targets (#676) read as the entries that parse, like nodeOrder.
  if (isObject(data) && Object.hasOwn(data, 'expiry')) {
    const kept = expirySchema.safeParse(data.expiry);
    if (kept.success) data = { ...data, expiry: kept.data };
    else {
      delete data.expiry;
      dropped.push(['expiry']);
    }
  }
  for (const key of ['expiryWarnDays', 'expiryCritDays']) {
    if (isObject(data) && Object.hasOwn(data, key) && !expiryDaysOk(data[key])) {
      delete data[key];
      dropped.push([key]);
    }
  }
  return { config: data, dropped };
}

/**
 * The file's bytes as a config: `{ config }`, an object, without what a save
 * would refuse (healed); or `{ unusable }`, why it is none, for a file that
 * doesn't parse or isn't a JSON object.
 */
function storedConfig(bytes, version) {
  let data;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    log.error(jsonFileErrorFields(err), 'Failed to read');
    const why = describeParseError(jsonParseError(err));
    return { unusable: `display-config.json doesn't parse (${why}); the next save rewrites it` };
  }
  if (!isObject(data)) {
    log.error('Failed to read: display-config.json is not a JSON object');
    return { unusable: "display-config.json isn't a JSON object; the next save rewrites it" };
  }
  const { config, dropped } = healed(data);
  if (dropped.length > 0 && warnedVersion !== version) {
    warnedVersion = version;
    const paths = dropped.map(pathText);
    log.warn(
      { paths },
      `display-config.json has values no save would take (${paths.join(', ')}); ` +
        'left out of what devices read, so the next save drops them'
    );
  }
  return { config };
}

/** Why a file that is there can't be read (#536): its error in plain words, never its path. */
const unreadable = (err) =>
  `display-config.json can't be read (${readErrorWords(err)}): fix it on the host; ` +
  "JagHelm won't save over a file it can't read";

/** Whether `interval` differs from the stored one (bytes null: no file). */
function intervalChangedFrom(bytes, interval) {
  if (!bytes) return true;
  try {
    return JSON.parse(bytes.toString('utf8'))?.refreshInterval !== interval;
  } catch {
    return true;
  }
}

/** The `themes` of the file's bytes (null: no file, or none that parses). */
function storedThemes(bytes) {
  if (!bytes) return null;
  try {
    return JSON.parse(bytes.toString('utf8'))?.themes ?? null;
  } catch {
    return null;
  }
}

router.get('/', (req, res) => {
  try {
    const disk = readVersioned(DISPLAY_CONFIG_PATH);
    if (disk.readError) {
      log.error({ err: disk.readError }, 'Failed to read');
      return configUnusable(res, unreadable(disk.readError), CONFIG_UNREADABLE);
    }
    const etag = etagOf(disk.version);
    res.set('ETag', etag);
    if (!disk.bytes) {
      if (ifNoneMatchHits(req.get('If-None-Match'), etag)) return res.status(304).end();
      return res.json(null);
    }
    const stored = storedConfig(disk.bytes, disk.version);
    // With its version, so a device can save its whole copy over it.
    if (stored.unusable) return configUnusable(res, stored.unusable, CONFIG_UNPARSEABLE);
    if (ifNoneMatchHits(req.get('If-None-Match'), etag)) return res.status(304).end();
    res.json(stored.config);
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
      log.warn({ err: disk.readError }, "display-config.json can't be read; not saving over it");
      return configUnusable(res, unreadable(disk.readError), CONFIG_UNREADABLE);
    }
    if (!ifMatchHits(ifMatch, disk.version)) {
      return refuseStale(
        res,
        'The display settings changed since this device read them; read them again',
        disk.version
      );
    }

    const config = v.data;
    // A theme this save adds or changes must keep the contrast rules (#331).
    const badTheme = themesSaveError(config.themes, storedThemes(disk.bytes));
    if (badTheme) return apiError(res, 400, badTheme);
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
