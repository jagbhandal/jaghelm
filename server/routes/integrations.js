/**
 * Integrations API.
 *
 *   GET    /api/integrations           → all configured integrations' data
 *   GET    /api/integrations/presets   → built-in preset gallery
 *   GET    /api/integrations/:type     → one integration's live data
 *   POST   /api/integrations/test      → connection test before save
 *   POST   /api/integrations/save      → encrypt creds + write config
 *   DELETE /api/integrations/:type     → remove a configured integration
 *
 * Multiple instances of the same preset are supported via the optional
 * `instance` field, which gets folded into the storage key
 * (e.g. type=adguard, instance=primary → adguard_primary).
 */

import { Router } from 'express';

import { getConfig, saveConfig } from '../config.js';
import { setSecret } from '../secrets.js';
import { getPreset, listPresets } from '../integrations/registry.js';
import { fetchIntegration, testIntegration } from '../integrations/handler.js';
import { refreshIntegrations } from '../refresh.js';
import { getCached, jsonWithEtag } from '../cache.js';
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
  asyncHandler(async (req, res) => {
    const cached = getCached('integrations');
    if (cached) return jsonWithEtag(res, req, 'integrations', cached);

    const data = await refreshIntegrations();
    if (data) return jsonWithEtag(res, req, 'integrations', data);

    res.json({});
  })
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

router.post('/save', (req, res) => {
  const {
    type,
    instance,
    url,
    username,
    password,
    token,
    enabled,
    target,
    editingKey,
    fields: customFields,
  } = req.body || {};

  if (!type || !url) return apiError(res, 400, 'type and url are required');
  if (!SAFE_ID.test(type) || (instance && !SAFE_ID.test(instance))) {
    return apiError(res, 400, 'Invalid type or instance (letters, digits, _ - only; max 64)');
  }

  const cleanUrl = normalizeUrl(url);
  const storageKey = instance ? `${type}_${instance}` : type;

  try {
    if (password) setSecret(`integration_${storageKey}_password`, password);
    if (token) setSecret(`integration_${storageKey}_token`, token);

    const entry = {
      url: cleanUrl,
      enabled: enabled !== false,
    };

    if (getPreset(type)) entry.preset = type;
    if (instance) entry.instance = instance;
    if (target) entry.target = target;
    if (username) entry.username = username;
    if (password) entry.password = `$secret:integration_${storageKey}_password`;
    if (token) entry.token = `$secret:integration_${storageKey}_token`;

    // URL params (e.g. account_id for Cloudflare presets) — allow-listed to the
    // preset's declared urlParams; unknown keys are dropped (no config injection).
    Object.assign(entry, allowedParams(type, req.body.params));

    // Custom fields (only for non-preset integrations)
    if (customFields) entry.fields = customFields;

    const config = getConfig() || {};
    if (!config.integrations) config.integrations = {};

    // If editing under a renamed key, drop the old entry
    if (editingKey && editingKey !== storageKey) {
      delete config.integrations[editingKey];
    }

    config.integrations[storageKey] = entry;
    saveConfig(config);

    res.json({ ok: true, type: storageKey });
  } catch (err) {
    apiError(res, 500, 'Failed to save integration', err);
  }
});

// ── Delete ───────────────────────────────────────────────────────────────

router.delete('/:type', (req, res) => {
  const { type } = req.params;
  const config = getConfig() || {};
  if (!config.integrations?.[type]) {
    return apiError(res, 404, `Integration '${type}' not configured`);
  }

  delete config.integrations[type];
  saveConfig(config);
  res.json({ ok: true });
});

// ── Fetch one integration's data on demand ───────────────────────────────
// Note: this is the catch-all GET; declared LAST so /presets and / stay distinct.

router.get(
  '/:type',
  asyncHandler(async (req, res) => {
    const { type } = req.params;
    const config = getConfig();
    const integrations = config?.integrations || {};
    const yamlConfig = integrations[type];

    if (!yamlConfig && !getPreset(type)) {
      return apiError(res, 404, `Integration '${type}' not found`);
    }

    const result = await fetchIntegration(type, yamlConfig || {}, false);
    if (result.error) {
      return res.status(502).json({ error: result.error, fields: result.fields });
    }
    res.json(result);
  })
);

export { router as integrationRoutes };
