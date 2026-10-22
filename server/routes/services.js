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

import { readConfig, writeConfig } from '../config.js';
import {
  configMaskOptions,
  movedCredential,
  movedCredentialError,
} from '../integrations/movedCredential.js';
import { getMonitorNames } from '../monitors.js';
import { refreshServices } from '../refresh.js';
import { settleSecretsNamedBy } from '../integrations/secretBinding.js';
import { respondWarmCached } from '../cache.js';
import { apiError, configUnusable } from '../errors.js';
import { asyncHandler } from '../util/asyncHandler.js';
import { etagOf, ifMatchHits, refuseStale, versionNamed } from '../util/fileVersion.js';
import { validateConfig, servicesConfigSchema } from '../util/configSchema.js';
import { maskCredentials, restoreCredentials } from '../util/configMask.js';

const router = Router();

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

  // Each marker becomes the credential stored in its place. One where nothing
  // is stored, or in place of anything but a credential, is refused, so a
  // marker is never written and no credential moves to another place.
  const restored = restoreCredentials(v.data, current || {}, configMaskOptions());
  if (!restored.ok) return apiError(res, restored.status, restored.error);
  const moved = movedCredentialRefusal(restored.config, current);
  if (moved) return apiError(res, 400, moved);

  // A save that changes nothing writes nothing, so services.yaml stays
  // byte-for-byte as it was (every write re-serialises the whole file), as an
  // unchanged integration save (#402). Its version is the same.
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

router.get(
  '/monitors',
  asyncHandler(async (req, res) => {
    const names = await getMonitorNames();
    res.json(names);
  })
);

export { router as servicesRoutes };
