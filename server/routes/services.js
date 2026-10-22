/**
 * Services routes — the dashboard's primary data feed plus config CRUD.
 *
 *   GET  /api/services           → unified node + container + monitor payload
 *   GET  /api/services/config    → services.yaml as JSON, without its credentials,
 *                                  and its version as the ETag
 *   POST /api/services/config    → replace services.yaml, keeping stored credentials,
 *                                  only over the version in If-Match
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
 *
 * The write needs the version the tab read (#423). The read answers
 * services.yaml's version (a keyed HMAC of the file, config.js) as a strong
 * ETag, and the write must send it back in If-Match: none is a 428, and one
 * that is no longer the file's is a 409, so a tab left open from before a
 * change can't post its old copy over it. Nothing is written either way. A
 * save answers with the new version as its ETag, so the tab can save again
 * without reading.
 *
 * While services.yaml doesn't parse (or is empty, or not a mapping), the read
 * and the write are both a 503 `config_unparseable` saying so, with no
 * version: the last good config the board keeps is not this file's (#423).
 */

import { isDeepStrictEqual } from 'node:util';

import { Router } from 'express';

import { readConfig, writeConfig } from '../config.js';
import { getPresetFull, listPresets } from '../integrations/registry.js';
import { getMonitorNames } from '../monitors.js';
import { refreshServices } from '../refresh.js';
import { respondWarmCached } from '../cache.js';
import { apiError, configUnparseable } from '../errors.js';
import { asyncHandler } from '../util/asyncHandler.js';
import { validateConfig, servicesConfigSchema } from '../util/configSchema.js';
import { maskCredentials, restoreCredentials } from '../util/configMask.js';

const router = Router();

/**
 * What the masking needs to know about the presets: each entry's preset (its
 * endpoints' placeholders are masked on the entry), as the refresh loop picks
 * it, and every URL parameter a preset's form shows and saves (never masked).
 * Exported for the tests.
 */
export function configMaskOptions() {
  return {
    presetOf: (/** @type {string} */ key, /** @type {any} */ entry) =>
      getPresetFull(entry?.preset || key),
    urlParamKeys: listPresets().flatMap((p) => (p.urlParams || []).map((u) => u.key)),
  };
}

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

/** A version as an ETag: strong, quoted. */
const etagOf = (/** @type {string} */ version) => `"${version}"`;

/**
 * Whether an If-Match header names `version`: one of its entity-tags is it.
 * A `W/` prefix is ignored, since a proxy that compresses the read (nginx's
 * gzip) weakens its ETag on the way. `*` is no version: a save must say which
 * one it read.
 */
function ifMatchHits(/** @type {string} */ header, /** @type {string} */ version) {
  const want = etagOf(version);
  return header.split(',').some((part) => part.trim().replace(/^W\//, '') === want);
}

/** A save over a version that is no longer the file's (#423). */
function staleSave(res) {
  return res.status(409).json({
    error: 'services.yaml changed since Settings read it; reload Settings and try again',
    stale: true,
  });
}

router.get('/config', (req, res) => {
  const { config, version, unusable } = readConfig();
  if (unusable) return configUnparseable(res, unusable);
  res.set('ETag', etagOf(version));
  res.json(maskCredentials(config || {}, configMaskOptions()));
});

// Synchronous from the read to the write (#423): no other request can write
// services.yaml after the version check, and writeConfig checks it again
// against the file as it writes.
router.post('/config', (req, res) => {
  const v = validateConfig(servicesConfigSchema, req.body);
  if (!v.ok) return apiError(res, v.status, v.error);

  const ifMatch = req.get('If-Match');
  if (!ifMatch) {
    return apiError(res, 428, 'The save named no config version (If-Match); reload Settings');
  }
  const { config: current, version, unusable } = readConfig();
  if (unusable) return configUnparseable(res, unusable);
  if (!ifMatchHits(ifMatch, version)) return staleSave(res);

  // Each marker becomes the credential stored in its place. One where nothing
  // is stored, or in place of anything but a credential, is refused, so a
  // marker is never written and no credential moves to another place.
  const restored = restoreCredentials(v.data, current || {}, configMaskOptions());
  if (!restored.ok) return apiError(res, restored.status, restored.error);

  // A save that changes nothing writes nothing, so services.yaml stays
  // byte-for-byte as it was (every write re-serialises the whole file), as an
  // unchanged integration save (#402). Its version is the same.
  if (current && isDeepStrictEqual(restored.config, current)) {
    res.set('ETag', etagOf(version));
    return res.json({ ok: true });
  }

  const saved = writeConfig(restored.config, version);
  if (!saved.ok && saved.conflict) return staleSave(res);
  if (!saved.ok && saved.unusable) return configUnparseable(res, saved.unusable);
  // A write failure (or a reentrant save) is a 500, not a misleading
  // HTTP 200 { ok: false }.
  if (!saved.ok) return apiError(res, 500, 'Failed to persist config');
  res.set('ETag', etagOf(saved.version));
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
