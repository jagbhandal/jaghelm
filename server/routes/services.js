/**
 * Services routes — the dashboard's primary data feed plus config CRUD.
 *
 *   GET  /api/services           → unified node + container + monitor payload
 *   GET  /api/services/config    → services.yaml as JSON, without its credentials,
 *                                  and its version as the ETag
 *   POST /api/services/config    → replace services.yaml, keeping stored credentials,
 *                                  only over the version in If-Match
 *   POST /api/services/nodes/find → the nodes Prometheus knows that services.yaml
 *                                  doesn't have (#572; writes nothing)
 *   GET  /api/services/monitors  → flat list of Kuma monitor names
 *   GET  /api/services/monitor-mapping → per running container: the monitor it
 *                                  carries, the one Auto-match would pick and
 *                                  how, and similar monitors (#319; read-only),
 *                                  and `monitorOnly`: each monitor no container
 *                                  carries, the node it is on and why (#644)
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
 *
 * The write needs the version the tab read (#423). The read answers
 * services.yaml's version (a keyed HMAC of the file, util/fileVersion.js, the
 * mechanism the display config shares, #547) as a strong ETag, and the write
 * must send it back in If-Match: none is a 428, and one that is no longer the
 * file's is a 409, so a tab left open from before a change can't post its old
 * copy over it. Nothing is written either way. A save answers with the new
 * version as its ETag, so the tab can save again without reading.
 *
 * A stored credential goes only to the address it was entered for (#556): a
 * write that keeps a stored credential (its marker, or its value sent again)
 * on an integration entry whose URL it moves to another origin is refused
 * (400, naming the place), whether the credential is in the secret store or
 * typed into services.yaml by hand; the integration form refuses the same
 * (integrations/movedCredential.js). It is entered again for the new address.
 *
 * While services.yaml doesn't parse (or is empty, or not a mapping), the read
 * and the write are both a 503 `config_unparseable` saying so, with no
 * version: the last good config the board keeps is not this file's (#423).
 * While it is there but can't be read (permissions, a directory, a disk
 * error), both are a 503 `config_unreadable` the same way (#536): a save
 * never writes over a file JagHelm couldn't read.
 */

import { isDeepStrictEqual } from 'node:util';

import { Router } from 'express';

import { getConfig, readConfig, writeConfig } from '../config.js';
import { findNewNodes } from '../findNodes.js';
import { noPrometheus, promUrlUnset } from '../discovery.js';
import { colonNodeKeys } from '../util/nodeKeys.js';
import { failureDetail, failureSentence } from '../failureWords.js';
import { createLogger } from '../util/logger.js';
import { createRateLimiter } from '../util/rateLimiter.js';
import {
  configMaskOptions,
  movedCredential,
  movedCredentialError,
} from '../integrations/movedCredential.js';
import { fetchMonitors, getMonitorNames } from '../monitors.js';
import { monitorMappingView, monitorOnlyView } from '../monitorMapping.js';
import { refreshServices } from '../refresh.js';
import { settleSecretsNamedBy } from '../integrations/secretBinding.js';
import { getCached, getCachedInternal, respondWarmCached } from '../cache.js';
import { apiError, configUnusable } from '../errors.js';
import { asyncHandler } from '../util/asyncHandler.js';
import { etagOf, ifMatchHits, refuseStale, versionNamed } from '../util/fileVersion.js';
import { validateConfig, servicesConfigSchema } from '../util/configSchema.js';
import { maskCredentials, restoreCredentials } from '../util/configMask.js';

const router = Router();
const log = createLogger('services');

// Each look is a Prometheus query: throttle it per IP, as the integration test.
const findLimiter = createRateLimiter({ max: 10, windowMs: 60_000 });

// What the masking needs to know about the presets (integrations/movedCredential.js).
export { configMaskOptions };

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

const isMap = (/** @type {unknown} */ v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Why a write is refused for keeping a stored credential on an integration
 * entry it moves to another origin (#556), or null: the first entry of
 * `restored` (the posted config with each marker replaced) that keeps one of
 * `current`'s credentials while its URL leaves the origin it had
 * (integrations/movedCredential.js). It names the place, never a value or an
 * origin.
 * @param {any} restored
 * @param {any} current
 */
function movedCredentialRefusal(restored, current) {
  const entries = restored?.integrations;
  if (!isMap(entries) || !isMap(current?.integrations)) return null;
  for (const [key, after] of Object.entries(entries)) {
    const before = current.integrations[key];
    if (!Object.hasOwn(current.integrations, key) || !isMap(before) || !isMap(after)) continue;
    const moved = movedCredential({ beforeKey: key, before, afterKey: key, after });
    if (moved) return movedCredentialError(moved, `integrations.${key}`);
  }
  return null;
}

/** A save over a version that is no longer the file's (#423). */
const staleSave = (res, version) =>
  refuseStale(
    res,
    'services.yaml changed since Settings read it; reload Settings and try again',
    version
  );

router.get('/config', (req, res) => {
  const { config, version, unusable, code } = readConfig();
  if (unusable) return configUnusable(res, unusable, code);
  res.set('ETag', etagOf(version));
  res.json(maskCredentials(config || {}, configMaskOptions()));
});

// Synchronous from the read to the write (#423): no other request can write
// services.yaml after the version check, and writeConfig checks it again
// against the file as it writes.
router.post('/config', (req, res) => {
  const v = validateConfig(servicesConfigSchema, req.body);
  if (!v.ok) return apiError(res, v.status, v.error);

  const ifMatch = versionNamed(
    req,
    res,
    'The save named no config version (If-Match); reload Settings'
  );
  if (ifMatch == null) return;
  const { config: current, version, unusable, code } = readConfig();
  if (unusable) return configUnusable(res, unusable, code);
  if (!ifMatchHits(ifMatch, version)) return staleSave(res, version);

  // A new node key with a ':' would split wrongly in the board's ids, per-node
  // overrides and groups (#572). Keys the file already has are left as they are.
  const oldKeys = new Set(Object.keys(current?.nodes && !Array.isArray(current.nodes) ? current.nodes : {}));
  const bad = colonNodeKeys(v.data.nodes).filter((k) => !oldKeys.has(k));
  if (bad.length) {
    return apiError(res, 400, `Node key "${bad[0]}" can't contain ':'; name it without the port (the Prometheus node label can keep it)`);
  }

  // Each marker becomes the credential stored in its place. One where nothing
  // is stored, or in place of anything but a credential, is refused, so a
  // marker is never written and no credential moves to another place.
  const restored = restoreCredentials(v.data, current || {}, configMaskOptions());
  if (!restored.ok) return apiError(res, restored.status, restored.error);
  const moved = movedCredentialRefusal(restored.config, current);
  if (moved) return apiError(res, 400, moved);

  // A save that changes nothing writes nothing, so services.yaml stays
  // byte-for-byte as it was (a write can still even out its spacing, #416),
  // as an unchanged integration save (#402). Its version is the same.
  if (current && isDeepStrictEqual(restored.config, current)) {
    res.set('ETag', etagOf(version));
    return res.json({ ok: true });
  }

  // A secret from before #556 still waiting to be bound (services.yaml was
  // missing at boot) is never bound by what this save names.
  try {
    settleSecretsNamedBy(restored.config);
  } catch {
    return apiError(res, 500, 'Failed to persist config');
  }

  const saved = writeConfig(restored.config, version);
  if (!saved.ok && saved.conflict) return staleSave(res, saved.version);
  if (!saved.ok && saved.unusable) return configUnusable(res, saved.unusable, saved.code);
  // A write failure (or a reentrant save) is a 500, not a misleading
  // HTTP 200 { ok: false }.
  if (!saved.ok) return apiError(res, 500, 'Failed to persist config');
  res.set('ETag', etagOf(saved.version));
  res.json({ ok: true });
});

/**
 * Find nodes (#572): ask Prometheus now and answer `{ nodes }`, the ones
 * services.yaml lacks in a first boot's shape (possibly none). It writes
 * nothing: Settings adds them with its ordinary save, over the version it
 * read, so a file that moved meanwhile is the usual 409. Prometheus that
 * can't be asked is a 502 saying why in words (failureWords.js).
 */
router.post(
  '/nodes/find',
  asyncHandler(async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!findLimiter(ip)) return apiError(res, 429, 'Too many tries to find nodes: wait a minute.');
    const { config, unusable, code } = readConfig();
    if (unusable) return configUnusable(res, unusable, code);
    // Nothing to ask: say so, not "No new nodes".
    if (noPrometheus() || promUrlUnset()) {
      return res.status(502).json({
        error: failureSentence('prometheus', { cause: 'unset' }),
        code: 'prometheus_unset',
      });
    }
    let nodes;
    try {
      nodes = await findNewNodes(config);
    } catch (err) {
      log.warn({ detail: failureDetail(err) }, 'find nodes: Prometheus could not be asked');
      return apiError(res, 502, failureSentence('prometheus', err));
    }
    res.json({ nodes });
  })
);

router.get(
  '/monitors',
  asyncHandler(async (req, res) => {
    const names = await getMonitorNames();
    res.json(names);
  })
);

/**
 * What Settings offers to map a monitor to a container (#319): from the last
 * refresh's board and Kuma's monitors, nothing new is read. Empty until the
 * first refresh has run, when Settings shows no suggestions.
 */
router.get(
  '/monitor-mapping',
  asyncHandler(async (req, res) => {
    const board = getCached('services');
    if (!board?.nodes) return res.json({ services: {}, monitorOnly: [] });
    const { monitors } = await fetchMonitors();
    const internal = getCachedInternal('services');
    res.json({
      services: monitorMappingView({
        nodes: board.nodes,
        monitorOf: internal?.monitorOf ?? {},
        monitors,
        services: getConfig()?.services ?? {},
      }),
      monitorOnly: monitorOnlyView({
        monitorPlaced: internal?.monitorPlaced,
        monitorOf: internal?.monitorOf,
        monitors,
      }),
    });
  })
);

export { router as servicesRoutes };
