/**
 * Integrations API.
 *
 *   GET    /api/integrations           → all configured integrations' data
 *   GET    /api/integrations/presets   → built-in preset gallery
 *   POST   /api/integrations/test      → connection test before save
 *   POST   /api/integrations/save      → encrypt creds + merge the form into config
 *   PATCH  /api/integrations/:key      → enable or disable, { enabled } only
 *   DELETE /api/integrations/:type     → remove a configured integration and its secrets
 *
 * Multiple instances of the same preset are supported via the optional
 * `instance` field, which gets folded into the storage key
 * (e.g. type=adguard, instance=primary → adguard_primary).
 *
 * There is no GET /:type: it returned one integration's data with the whole
 * upstream response and had no caller (#254). The dashboard reads GET /.
 *
 * Each write reads services.yaml with readConfig and writes it with
 * writeConfig over the version it read, in the same synchronous handler
 * (#423): it starts from the file as it is, and changes the version a
 * Settings tab must send to save the whole config. While the file doesn't
 * parse, each is refused (503 `config_unparseable`) before it changes
 * anything, a stored credential included; writeConfig refuses it too.
 *
 * services.yaml is the record of which secrets an integration has (#502,
 * #415): a save stores what it needs before the file is written, and puts the
 * secret store back as it was if the write fails, so secrets.json ends
 * byte-for-byte as before; a secret secrets.json can't take refuses the save.
 * A delete or a rename drops what it frees, and no other entry uses, once the
 * file is written. A crash between the two leaves only secrets no entry uses,
 * which the boot log counts (integrations/unusedSecrets.js).
 */

import { isDeepStrictEqual } from 'node:util';

import { Router } from 'express';

import { readConfig, writeConfig } from '../config.js';
import {
  copySecret,
  deleteSecret,
  deleteSecrets,
  hasSecret,
  listSecretKeys,
  restoreSecrets,
  setSecret,
  snapshotSecrets,
} from '../secrets.js';
import { getPreset, listPresets } from '../integrations/registry.js';
import { testIntegration } from '../integrations/handler.js';
import { KEYED_SECRET_FIELDS, keyedSecretName } from '../integrations/lib/config.js';
import {
  dropUnusedIntegrationSecrets,
  unusedIntegrationSecrets,
} from '../integrations/unusedSecrets.js';
import { refreshIntegrations, retryIntegrationNow } from '../refresh.js';
import { respondWarmCached } from '../cache.js';
import { apiError, configUnparseable } from '../errors.js';
import { asyncHandler } from '../util/asyncHandler.js';
import { createRateLimiter } from '../util/rateLimiter.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('integrations');
const router = Router();

// The connection test fetches a user-supplied URL, so it's a reachability/
// port-scan oracle (even with the SSRF guard). Throttle per-IP and audit it.
const testLimiter = createRateLimiter({ max: 10, windowMs: 60_000 });

// Preset type + instance become part of the secret key / config key, so bound them.
const SAFE_ID = /^[\w-]{1,64}$/;

// Allow-list user-supplied `params` to the preset's declared urlParams keys, so a
// client can't fold handler-honored keys (endpoint/url override, tlsSkip to disable
// cert validation, extraHeaders, authHeader, extraEndpoints) into the saved/tested
// config. Non-preset (custom) integrations declare no urlParams -> nothing accepted.
export function allowedParams(type, params) {
  if (!params || typeof params !== 'object') return {};
  const keys = new Set((getPreset(type)?.urlParams || []).map((p) => p.key));
  const out = {};
  for (const [k, v] of Object.entries(params)) if (keys.has(k)) out[k] = v;
  return out;
}

/** Auto-prepend http:// when the user types a bare host. */
function normalizeUrl(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

// ── List presets ─────────────────────────────────────────────────────────

router.get('/presets', (req, res) => {
  res.json(listPresets());
});

// ── Aggregate live data for the dashboard ────────────────────────────────

router.get(
  '/',
  asyncHandler((req, res) =>
    respondWarmCached(req, res, {
      key: 'integrations',
      refresh: refreshIntegrations,
      fallback: (r) => r.json({}),
    })
  )
);

// ── Test connection (creds in body, not stored) ──────────────────────────

router.post(
  '/test',
  asyncHandler(async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!testLimiter(ip)) {
      log.warn({ ip }, 'integration test rate-limited');
      return apiError(res, 429, 'Too many connection tests — slow down.');
    }

    const { type, url, username, password, token, params } = req.body || {};
    if (!url) return res.status(400).json({ ok: false, error: 'URL is required' });

    const cleanUrl = normalizeUrl(url);
    // Audit the probe target (host only, never the credentials in the body).
    let host = cleanUrl;
    try {
      host = new URL(cleanUrl).host;
    } catch {
      /* keep the raw string if it doesn't parse */
    }

    const testConfig = { url: cleanUrl, username, password, token, ...allowedParams(type, params) };
    const result = await testIntegration(type || '_custom', testConfig);
    log.info({ ip, type: type || '_custom', host, ok: !!result.ok }, 'integration connection test');
    res.json(result);
  })
);

// ── Save (encrypts secrets into secrets.json, config into services.yaml) ──
//
// A save merges the form into the integration's stored entry (#402). It used
// to rebuild the entry from the form, so whatever the form doesn't send was
// lost: a custom integration's endpoint, auth, header and fields, a credential
// under a secret name Settings doesn't derive, and any key written by hand.
// Now only what the form owns changes:
//   - url, always sent and required (normalized);
//   - username and target, when sent: an empty one is removed;
//   - the preset's URL params, when sent (allow-listed): an empty one is removed;
//   - password and token, only when typed (text only): blank keeps what is
//     stored, a plaintext value or a `$secret:` under any name;
//   - fields, when sent;
//   - instance, which is part of the key: a changed one moves the entry, and
//     its keyed secrets with it, to its new key; an unchanged one keeps the
//     entry where it is, even under a key Settings would not derive (`my_npm`,
//     `npm_Two`).
// `enabled` is set by a save that creates the entry, or one without an
// `editingKey` (an older web app's toggle sent those). An edit leaves it to the
// toggle route, so a form left open can't undo a toggle made since. An edit
// whose entry is gone is refused (409) rather than merged into another one.
// A save never lands on a key another integration holds (#414): a rename onto
// one, or an add the form marks `create`, is refused (409) naming it, before
// anything is stored. A save without `editingKey` or `create` still merges
// into the entry under its key, since an older web app's toggle posts that.
// The preset of an existing entry is never changed. A save that changes
// nothing writes nothing, so services.yaml stays byte-for-byte as it was
// (every write re-serialises the whole file); it still asks for a retry.
// A save whose services.yaml write fails, is refused or throws stores nothing
// (#502): the secret store goes back to what it held before the save, and
// secrets.json byte-for-byte with it. One whose secret secrets.json can't
// take is refused (500) the same way. A save that creates an entry first
// clears what an older delete left under its key (#415), so it starts with
// no credential but the one typed.

/**
 * Write `config` over `version`, the one this handler read. A refusal is
 * answered here: false means the response is sent. services.yaml changing
 * between this handler's read and write would take a writer outside this
 * process (a hand edit in the same instant).
 */
function written(res, config, version) {
  const saved = writeConfig(config, version);
  if (saved.ok) return true;
  if (saved.conflict) apiError(res, 409, 'services.yaml changed while saving; try again');
  else if (saved.unusable) configUnparseable(res, saved.unusable);
  // A write failure (or a reentrant save) is a 500, not a reported success,
  // matching services.js POST /config.
  else apiError(res, 500, 'Failed to persist config');
  return false;
}

/** True for a value the form sends for an empty field. */
const isBlank = (v) => v === undefined || v === null || v === '';

/** True when an edit names the entry it edits (the web form sends it then). */
const isSent = (v) => v !== undefined && v !== null && v !== '';

/** An instance name as the web form normalizes it (lowercase a-z, 0-9, -). */
function formInstance(v) {
  return typeof v === 'string' ? v.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') : '';
}

/** The stored entry under `key`, when it is one (own key, an object). */
function storedEntry(integrations, key) {
  if (typeof key !== 'string' || !Object.hasOwn(integrations, key)) return null;
  const entry = integrations[key];
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null;
}

/** An integration's name as the Settings list shows it (HomeView.jsx). */
function listName(key, entry) {
  const presetType = entry.preset || (key.includes('_') ? key.split('_')[0] : key);
  const name = getPreset(presetType)?.name;
  if (entry.instance) return `${name || presetType} (${entry.instance})`;
  return name || key;
}

/**
 * Why a save onto `key`, which `holder` already holds, is refused: it names
 * the holder as the list does (one it names by its key is a custom
 * integration), and says what to do: a preset's form has an Instance Name
 * field to change; the custom builder has none and always derives `_custom`.
 */
function takenKeyError(key, holder, type) {
  const name = listName(key, holder);
  const taken =
    name === key
      ? `A custom integration is already saved under '${key}'`
      : `${name} already uses the key '${key}'`;
  return `${taken}; ${getPreset(type) ? 'choose another instance name' : 'edit or remove it first'}`;
}

/** Set an owned field: an empty value removes it, unless it is already empty. */
function setOwned(entry, key, value) {
  if (!isBlank(value)) entry[key] = value;
  else if (!isBlank(entry[key])) delete entry[key];
}

router.post('/save', (req, res) => {
  const body = req.body || {};
  const { type, instance, url, password, token, enabled, editingKey, fields: customFields } = body;

  const cleanUrl = normalizeUrl(typeof url === 'string' ? url : '');
  if (!type || !cleanUrl) return apiError(res, 400, 'type and url are required');
  if (!SAFE_ID.test(type) || (instance && !SAFE_ID.test(instance))) {
    return apiError(res, 400, 'Invalid type or instance (letters, digits, _ - only; max 64)');
  }
  // A credential is text. Anything else used to reach setSecret, whose error
  // (with the value in it) was then logged.
  for (const value of [password, token]) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return apiError(res, 400, 'password and token must be text');
    }
  }
  const unsupported = getPreset(type)?.unsupported;
  if (unsupported) {
    return apiError(res, 400, `Integration unavailable: ${unsupported}`);
  }

  // The secret store as it was before this save stored anything, put back
  // unless services.yaml ends up written or needs no write (#502).
  let before = null;
  let committed = false;
  try {
    const read = readConfig();
    // Before any credential is stored: a refused save changes nothing.
    if (read.unusable) return configUnparseable(res, read.unusable);
    const config = read.config || {};
    if (!config.integrations) config.integrations = {};
    const { integrations } = config;

    // The entry this save is for: the one being edited, else the one already
    // under the key this save derives (the gallery adding it again, or an
    // older web app's toggle, which sent the key as the type).
    const derivedKey = instance ? `${type}_${instance}` : type;
    const editing = isSent(editingKey);
    let baseKey = null;
    let base = null;
    if (editing) {
      base = storedEntry(integrations, editingKey);
      // Removed (or replaced) since the form was opened, in another tab or by
      // a hand edit: merging into whatever is under the derived key would
      // overwrite a different integration.
      if (!base) {
        return apiError(
          res,
          409,
          `Integration '${editingKey}' is no longer configured; reload Settings and try again`
        );
      }
      baseKey = editingKey;
    } else if ((base = storedEntry(integrations, derivedKey))) {
      baseKey = derivedKey;
    }

    let storageKey = derivedKey;
    let instanceOwned = !!instance;
    if (editing) {
      // The key changes only when the instance name does.
      instanceOwned = formInstance(base.instance) !== (instance || '');
      if (!instanceOwned) storageKey = editingKey;
    } else if (base) {
      instanceOwned = !!instance && formInstance(base.instance) !== instance;
    }
    const moving = !!base && storageKey !== baseKey;

    // A rename onto a key another integration holds used to delete this entry
    // and write over that one, its secrets too (#414); an add from the form
    // (`create`) onto a taken key merged into that integration. Both are
    // refused before any secret is stored, so nothing changes.
    const creating = !editing && body.create === true;
    const holder = moving || creating ? storedEntry(integrations, storageKey) : null;
    if (holder) {
      return res
        .status(409)
        .json({ error: takenKeyError(storageKey, holder, type), field: 'instance' });
    }

    // From here on, anything short of `committed` puts this back (finally).
    before = snapshotSecrets();

    // A new entry starts with no credential (#415): what a delete before
    // #415 left under its key, and no other entry uses, goes first.
    if (!base) deleteSecrets(unusedIntegrationSecrets(config, listSecretKeys(), storageKey));

    // setSecret returns false when the secrets manager is uninitialized (no
    // DASH_SECRET). Writing entry.password="$secret:…" anyway would persist a
    // config pointing at a credential that was never stored — the integration
    // silently has no credential and fails later with no save-time error. Surface
    // it as a 500 now, matching the standalone secrets route.
    const typed = { password, token };
    for (const field of ['password', 'token']) {
      if (typed[field] && !setSecret(keyedSecretName(storageKey, field), typed[field])) {
        return apiError(res, 500, 'Secrets manager not initialized (DASH_SECRET missing?)');
      }
    }

    // A new entry keeps the shape and key order a save has always written.
    const entry = base ? { ...base } : { url: cleanUrl, enabled: enabled !== false };
    entry.url = cleanUrl;
    if (!editing && typeof enabled === 'boolean' && (entry.enabled !== false) !== enabled) {
      entry.enabled = enabled;
    }
    if (!base && getPreset(type)) entry.preset = type;
    if (instanceOwned) setOwned(entry, 'instance', instance);
    if (Object.hasOwn(body, 'target')) setOwned(entry, 'target', body.target);
    if (Object.hasOwn(body, 'username')) setOwned(entry, 'username', body.username);
    for (const field of ['password', 'token']) {
      if (typed[field]) entry[field] = `$secret:${keyedSecretName(storageKey, field)}`;
    }

    // URL params (e.g. account_id for Cloudflare presets) — allow-listed to the
    // preset's declared urlParams; unknown keys are dropped (no config injection).
    for (const [k, v] of Object.entries(allowedParams(type, body.params))) setOwned(entry, k, v);

    // Custom fields (only for non-preset integrations)
    if (customFields) entry.fields = customFields;

    // A move takes the entry's keyed secrets with it. What the old key held is
    // copied to the new key (still encrypted), replacing anything left there,
    // and a `$secret:` reference to the old name now names the new one. When
    // the old key held nothing, whatever is left under the new key is removed,
    // so it can't stand in for the entry's own credential. The old names are
    // removed once the move is written; until then the entry still uses them.
    const leftBehind = [];
    if (moving) {
      for (const field of KEYED_SECRET_FIELDS) {
        const from = keyedSecretName(baseKey, field);
        const to = keyedSecretName(storageKey, field);
        if (!typed[field] && !copySecret(from, to)) deleteSecret(to);
        if (hasSecret(from)) leftBehind.push(from);
        if ((field === 'password' || field === 'token') && entry[field] === `$secret:${from}`) {
          entry[field] = `$secret:${to}`;
        }
      }
    }

    const unchanged = base && !moving && isDeepStrictEqual(entry, base);
    if (!unchanged) {
      // A changed instance name moves the entry: drop it under its old key.
      if (moving) delete integrations[baseKey];
      integrations[storageKey] = entry;
      if (!written(res, config, read.version)) return;
    }
    // Written, or nothing to write: what this save stored stays. The old
    // names go unless another entry uses them (a `$secret:` written by hand).
    committed = true;
    dropUnusedIntegrationSecrets(config, leftBehind);
    // A save is the way to say "try again": the next refresh attempts it even
    // when its login was refused and nothing in it changed (#239).
    retryIntegrationNow(storageKey);

    res.json({ ok: true, type: storageKey });
  } catch (err) {
    apiError(res, 500, 'Failed to save integration', err);
  } finally {
    if (before && !committed) restoreSecrets(before);
  }
});

// ── Enable / disable ─────────────────────────────────────────────────────
//
// The toggle on an integration's row. It sets `enabled` and nothing else, and
// writes nothing when the integration is already in that state (#402). It used
// to go through /save with the row's URL and username, which rebuilt the entry
// without its target, params, credentials and, for an instance key such as
// adguard_primary, its preset.

router.patch('/:key', (req, res) => {
  const { key } = req.params;
  const body = req.body;
  if (
    !body ||
    typeof body !== 'object' ||
    typeof body.enabled !== 'boolean' ||
    Object.keys(body).length !== 1
  ) {
    return apiError(res, 400, 'Body must be { "enabled": true } or { "enabled": false }');
  }
  const { enabled } = body;

  const { config: read, version, unusable } = readConfig();
  if (unusable) return configUnparseable(res, unusable);
  const config = read || {};
  const integrations = config.integrations || {};
  const entry = storedEntry(integrations, key);
  if (!entry) return apiError(res, 404, `Integration '${key}' not configured`);

  if ((entry.enabled !== false) !== enabled) {
    entry.enabled = enabled;
    if (!written(res, config, version)) return;
  }
  // Enabling is a way to say "try again", as a save is.
  if (enabled) retryIntegrationNow(key);
  res.json({ ok: true, type: key, enabled });
});

// ── Delete ───────────────────────────────────────────────────────────────
//
// Deleting an integration deletes its secrets too (#415): once services.yaml
// is written without the entry, every `integration_<key>_*` secret no other
// entry uses is dropped, so a new integration under the same key starts with
// no credential. A secret another entry names (`$secret:`), or another
// entry's keyed one (`integration_npm_two_*` when `npm` is deleted), stays.
// A write that fails drops nothing. The entry is found by its own key, so
// `constructor` or `__proto__` is not configured.

router.delete('/:type', (req, res) => {
  const { type } = req.params;
  const { config: read, version, unusable } = readConfig();
  if (unusable) return configUnparseable(res, unusable);
  const config = read || {};
  if (!storedEntry(config.integrations || {}, type)) {
    return apiError(res, 404, `Integration '${type}' not configured`);
  }

  delete config.integrations[type];
  if (!written(res, config, version)) return;
  dropUnusedIntegrationSecrets(config, listSecretKeys(), type);
  res.json({ ok: true });
});

export { router as integrationRoutes };
