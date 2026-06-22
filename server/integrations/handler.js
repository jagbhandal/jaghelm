/**
 * JagHelm Integration Handler — all integrations, preset and custom, flow
 * through this single handler. Pipeline: resolve config → auth → fetch →
 * transform → cache. Owns the two orchestrators fetchIntegration + testIntegration.
 *
 * lib/ map: cache.js (response cache+TTL), http.js (safeFetch), extract.js (JSON
 * path DSL + URL templating), format.js (formatValue+computeField), auth.js
 * (buildAuthHeaders), session.js (session token cache+login), config.js (cred
 * resolution + config merging).
 */

import { getPresetFull } from './registry.js';

import { getCached, setCache } from './lib/cache.js';
import { safeFetch } from './lib/http.js';
import { extractValue, resolveEndpointParams } from './lib/extract.js';
import { formatValue, computeField } from './lib/format.js';
import { buildAuthHeaders } from './lib/auth.js';
import { fetchWithSession, testSessionAuth } from './lib/session.js';
import { resolveIntegrationConfig } from './lib/config.js';
import { assertSafeUrl } from '../util/ssrf.js';
import { redactError } from '../util/redact.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('integrations');

/**
 * Append query-param auth (`?apikey=…`) to a URL for the `query` auth type.
 * No-op for any other auth type or when no token is resolved. The token is
 * URL-encoded so a raw token containing reserved chars (&, =, +, space) can't
 * corrupt the query string or split into extra params.
 */
function applyQueryAuth(url, config) {
  if (config.auth === 'query' && config._token) {
    const paramName = config.queryParam || 'apikey';
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${paramName}=${encodeURIComponent(config._token)}`;
  }
  return url;
}

// Re-exported for back-compat; SSRF is also enforced at the fetch chokepoint in
// lib/http.js, so every auth path is guarded by construction.
export { resolveIntegrationConfig };
export { assertSafeUrl };

// ── Main fetch function for any integration ──
export async function fetchIntegration(type, yamlConfig, bustCache = false) {
  // Key by the unique storage key, not the preset type — otherwise two
  // instances of one preset (adguard_primary / adguard_secondary) share a key
  // and serve each other's data. refresh.js threads _storageKey through; the
  // GET /:type route passes the storage key as `type` directly.
  const cacheKey = `integration:${yamlConfig?._storageKey || type}`;

  if (!bustCache) {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  }

  const config = resolveIntegrationConfig(type, yamlConfig);
  if (!config || !config.url || !config.endpoint) {
    return { error: 'Integration not configured', fields: {} };
  }

  try {
    let rawData;
    const baseUrl = config.url.replace(/\/+$/, '');
    const skipTls = !!config.tlsSkip;

    if (config.auth === 'session') {
      rawData = await fetchWithSession(config);
    } else {
      let url = `${baseUrl}${resolveEndpointParams(config.endpoint, config)}`;
      url = applyQueryAuth(url, config);

      const headers = buildAuthHeaders(config);
      const res = await safeFetch(url, { headers }, skipTls);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
      }
      rawData = await res.json();
    }

    // extraEndpoints: array, or function(rawData) returning one so endpoints can
    // depend on the primary response (Proxmox: node name from VMs → /nodes/{node}/tasks).
    // Fetched in parallel; results attached to rawData._extra = { key: data }.
    const extraEpDef = config.extraEndpoints;
    const extraEps = typeof extraEpDef === 'function' ? extraEpDef(rawData) :
                     Array.isArray(extraEpDef) ? extraEpDef : null;
    if (extraEps && extraEps.length > 0) {
      const headers = buildAuthHeaders(config);
      const extraResults = await Promise.allSettled(
        extraEps.map(async (ep) => {
          const resolvedEp = resolveEndpointParams(ep.endpoint, config);
          const epUrl = `${baseUrl}${resolvedEp}`;
          const epRes = await safeFetch(epUrl, { headers }, skipTls);
          if (!epRes.ok) {
            throw new Error(`HTTP ${epRes.status} ${epRes.statusText || ''}`.trim());
          }
          return { key: ep.key, data: await epRes.json() };
        })
      );
      // Only attach _extra when rawData is a mutable object. A primary endpoint
      // that returns a bare array or a primitive would otherwise either throw
      // (primitive) or mis-attach a non-enumerable-ish prop onto an array.
      if (rawData && typeof rawData === 'object') {
        rawData._extra = {};
        for (const r of extraResults) {
          if (r.status === 'fulfilled' && r.value) {
            rawData._extra[r.value.key] = r.value.data;
          } else if (r.status === 'rejected') {
            // A failing extra sub-fetch used to vanish silently. Surface it with
            // a REDACTED reason — query-auth presets embed the API key in the URL
            // and fetch/undici errors echo the full URL, so never log it raw.
            log.warn({ type, reason: redactError(r.reason) }, 'extra endpoint fetch failed');
          }
        }
      } else {
        // rawData isn't an object we can hang _extra off of; still don't lose
        // the diagnostics for any rejected sub-fetch.
        for (const r of extraResults) {
          if (r.status === 'rejected') {
            log.warn({ type, reason: redactError(r.reason) }, 'extra endpoint fetch failed');
          }
        }
      }
    }

    // Transform fields
    const fields = {};
    for (const field of (config.fields || [])) {
      if (field.compute) {
        fields[field.label] = computeField(rawData, field);
      } else {
        const raw = extractValue(rawData, field.path);
        fields[field.label] = formatValue(raw, field.format || 'string');
      }
    }

    // Custom structured data transform (e.g. Proxmox VM list)
    let extra = {};
    if (config.structuredTransform) {
      extra = config.structuredTransform(rawData);
    }

    const result = { fields, ...extra, raw: rawData, error: null };
    setCache(cacheKey, result);
    return result;

  } catch (err) {
    // Redact before logging AND returning: query-auth presets put the API key
    // in the URL, and fetch errors embed the full URL — never leak it.
    const safe = redactError(err);
    log.error({ type, error: safe }, 'fetch error');
    return { error: safe, fields: {} };
  }
}

// ── Test connection: lightweight check that URL + creds work ──
export async function testIntegration(type, testConfig) {
  const preset = getPresetFull(type);

  // Merge preset with test config
  const config = preset ? { ...preset, ...testConfig } : testConfig;
  if (!config || !config.url) {
    return { ok: false, error: 'URL is required' };
  }

  // Resolve creds from the testConfig directly (not from secrets — these are fresh from the form)
  config._username = testConfig.username;
  config._password = testConfig.password;
  config._token = testConfig.token;

  const baseUrl = config.url.replace(/\/+$/, '');
  const testEndpoint = config.testEndpoint || config.endpoint;
  const skipTls = !!config.tlsSkip;

  try {
    if (config.auth === 'session') {
      // Try primary session auth
      const session = config.session;
      if (!session) return { ok: false, error: 'Session config missing in preset' };

      const primaryResult = await testSessionAuth(config, session, baseUrl, skipTls);
      if (primaryResult.ok) return primaryResult;

      // If primary failed and there's a fallback, try it
      const fallbackKey = config.authFallback;
      const fallbackSession = fallbackKey && config[fallbackKey];
      if (fallbackSession) {
        const fallbackResult = await testSessionAuth(config, fallbackSession, baseUrl, skipTls);
        if (fallbackResult.ok) return fallbackResult;
      }

      // Both failed — return error with instructions if available
      const instructions = config.oauth2Instructions || '';
      return {
        ok: false,
        error: instructions
          ? `Login failed — 2FA may be enabled.`
          : primaryResult.error,
        instructions: instructions || undefined,
      };

    } else {
      // Non-session auth (basic, bearer, header, query)
      const url = applyQueryAuth(`${baseUrl}${testEndpoint}`, config);
      const headers = buildAuthHeaders(config);
      const res = await safeFetch(url, { headers }, skipTls);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
      return { ok: true, status: res.status };
    }
  } catch (err) {
    return { ok: false, error: redactError(err) };
  }
}
