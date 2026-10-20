/**
 * Integrations API.
 *
 *   GET    /api/integrations           → all configured integrations' data
 *   GET    /api/integrations/presets   → built-in preset gallery
 *   POST   /api/integrations/test      → connection test before save
 *   POST   /api/integrations/save      → encrypt creds + merge the form into config
 *   PATCH  /api/integrations/:key      → enable or disable, { enabled } only
 *   DELETE /api/integrations/:type     → remove a configured integration
 *
 * Multiple instances of the same preset are supported via the optional
 * `instance` field, which gets folded into the storage key
 * (e.g. type=adguard, instance=primary → adguard_primary).
 *
 * There is no GET /:type: it returned one integration's data with the whole
 * upstream response and had no caller (#254). The dashboard reads GET /.
 */

import { isDeepStrictEqual } from 'node:util';

import { Router } from 'express';

import { getConfig, saveConfig } from '../config.js';
import { setSecret } from '../secrets.js';
import { getPreset, listPresets } from '../integrations/registry.js';
import { testIntegration } from '../integrations/handler.js';
import { refreshIntegrations, retryIntegrationNow } from '../refresh.js';
import { respondWarmCached } from '../cache.js';
import { apiError } from '../errors.js';
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
//   - enabled, when sent as true or false;
//   - username and target, when sent: an empty one is removed;
//   - the preset's URL params, when sent (allow-listed): an empty one is removed;
//   - password and token, only when typed: blank keeps what is stored, a
//     plaintext value or a `$secret:` under any name;
//   - fields, when sent;
//   - instance, which is part of the key: a changed one moves the entry to
//     its new key; an unchanged one keeps the entry where it is, even under a
//     key Settings would not derive (`my_npm`, `npm_Two`).
// The preset of an existing entry is never changed. A save that changes
// nothing writes nothing, so services.yaml stays byte-for-byte as it was
// (every write re-serialises the whole file); it still asks for a retry.

/** True for a value the form sends for an empty field. */
const isBlank = (v) => v === undefined || v === null || v === '';

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
  const unsupported = getPreset(type)?.unsupported;
  if (unsupported) {
    return apiError(res, 400, `Integration unavailable: ${unsupported}`);
  }

  try {
    const config = getConfig() || {};
    if (!config.integrations) config.integrations = {};
    const { integrations } = config;

    // The entry this save is for: the one being edited, else the one already
    // under the key this save derives (the gallery adding it again, or an
    // older web app's toggle, which sent the key as the type).
    const derivedKey = instance ? `${type}_${instance}` : type;
    let baseKey = null;
    let base = storedEntry(integrations, editingKey);
    if (base) baseKey = editingKey;
    else if ((base = storedEntry(integrations, derivedKey))) baseKey = derivedKey;

    let storageKey = derivedKey;
    let instanceOwned = !!instance;
    if (base && baseKey === editingKey) {
      // Editing: the key changes only when the instance name does.
      instanceOwned = formInstance(base.instance) !== (instance || '');
      if (!instanceOwned) storageKey = editingKey;
    } else if (base) {
      instanceOwned = !!instance && formInstance(base.instance) !== instance;
    }

    // setSecret returns false when the secrets manager is uninitialized (no
    // DASH_SECRET). Writing entry.password="$secret:…" anyway would persist a
    // config pointing at a credential that was never stored — the integration
    // silently has no credential and fails later with no save-time error. Surface
    // it as a 500 now, matching the standalone secrets route.
    if (password && !setSecret(`integration_${storageKey}_password`, password)) {
      return apiError(res, 500, 'Secrets manager not initialized (DASH_SECRET missing?)');
    }
    if (token && !setSecret(`integration_${storageKey}_token`, token)) {
      return apiError(res, 500, 'Secrets manager not initialized (DASH_SECRET missing?)');
    }

    // A new entry keeps the shape and key order a save has always written.
    const entry = base ? { ...base } : { url: cleanUrl, enabled: enabled !== false };
    entry.url = cleanUrl;
    if (typeof enabled === 'boolean' && (entry.enabled !== false) !== enabled) {
      entry.enabled = enabled;
    }
    if (!base && getPreset(type)) entry.preset = type;
    if (instanceOwned) setOwned(entry, 'instance', instance);
    if (Object.hasOwn(body, 'target')) setOwned(entry, 'target', body.target);
    if (Object.hasOwn(body, 'username')) setOwned(entry, 'username', body.username);
    if (password) entry.password = `$secret:integration_${storageKey}_password`;
    if (token) entry.token = `$secret:integration_${storageKey}_token`;

    // URL params (e.g. account_id for Cloudflare presets) — allow-listed to the
    // preset's declared urlParams; unknown keys are dropped (no config injection).
    for (const [k, v] of Object.entries(allowedParams(type, body.params))) setOwned(entry, k, v);

    // Custom fields (only for non-preset integrations)
    if (customFields) entry.fields = customFields;

    const unchanged = base && storageKey === baseKey && isDeepStrictEqual(entry, base);
    if (!unchanged) {
      // A changed instance name moves the entry: drop it under its old key.
      if (baseKey && baseKey !== storageKey) delete integrations[baseKey];
      integrations[storageKey] = entry;
      // saveConfig returns false on a write failure (or a reentrant save) — surface
      // that as a 500 instead of reporting success, matching services.js POST /config.
      if (!saveConfig(config)) return apiError(res, 500, 'Failed to persist config');
    }
    // A save is the way to say "try again": the next refresh attempts it even
    // when its login was refused and nothing in it changed (#239).
    retryIntegrationNow(storageKey);

    res.json({ ok: true, type: storageKey });
  } catch (err) {
    apiError(res, 500, 'Failed to save integration', err);
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

  const config = getConfig() || {};
  const integrations = config.integrations || {};
  const entry = storedEntry(integrations, key);
  if (!entry) return apiError(res, 404, `Integration '${key}' not configured`);

  if ((entry.enabled !== false) !== enabled) {
    entry.enabled = enabled;
    if (!saveConfig(config)) return apiError(res, 500, 'Failed to persist config');
  }
  // Enabling is a way to say "try again", as a save is.
  if (enabled) retryIntegrationNow(key);
  res.json({ ok: true, type: key, enabled });
});

// ── Delete ───────────────────────────────────────────────────────────────

router.delete('/:type', (req, res) => {
  const { type } = req.params;
  const config = getConfig() || {};
  if (!config.integrations?.[type]) {
    return apiError(res, 404, `Integration '${type}' not configured`);
  }

  delete config.integrations[type];
  // saveConfig returns false on a write failure (or a reentrant save) — surface
  // that as a 500 instead of reporting success, matching services.js POST /config.
  if (!saveConfig(config)) return apiError(res, 500, 'Failed to persist config');
  res.json({ ok: true });
});

export { router as integrationRoutes };
