/**
 * JagHelm Integration Handler — all integrations, preset and custom, flow
 * through this single handler. Pipeline: resolve config → auth → fetch →
 * transform. Owns the two orchestrators fetchIntegration + testIntegration.
 * Only the transformed result is returned; the upstream response is dropped
 * once the fields and structuredTransform have read it (#254).
 *
 * lib/ map: http.js (safeFetch), extract.js (JSON path DSL + URL templating),
 * format.js (formatValue+computeField), auth.js (buildAuthHeaders), session.js
 * (session token cache+login), config.js (cred resolution + config merging).
 */

import { getPresetFull } from './registry.js';

import { safeFetch, isAuthRejection } from './lib/http.js';
import { extractValue, resolveEndpoint, looksLikeSecretRef, UnresolvedSecretError } from './lib/extract.js';
import { formatValue, computeField } from './lib/format.js';
import { buildAuthHeaders } from './lib/auth.js';
import { fetchWithSession, testSessionAuth } from './lib/session.js';
import { resolveIntegrationConfig } from './lib/config.js';
import { assertSafeUrl } from '../util/ssrf.js';
import { redactError } from '../util/redact.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('integrations');

/**
 * Append query-param auth (`?apikey=…`) to a URL for the `query` auth type,
 * and `?apikey={token}` to `shownUrl`, the same URL as an error may show it
 * (safeFetch's shownUrl; defaults to `url`).
 * No-op for any other auth type or when no token is resolved. The token is
 * URL-encoded so a raw token containing reserved chars (&, =, +, space) can't
 * corrupt the query string or split into extra params.
 *
 * Returns the URL and whether the key went into it, for safeFetch's
 * credentialInUrl: a redirect to another origin could carry the query (and the
 * key) with it, so such a request refuses one.
 *
 * A `$secret:` reference is never put into the URL (#425): a token that looks
 * like one, or a reference that resolved to nothing, throws
 * UnresolvedSecretError, so no request is sent and the error says why.
 */
function applyQueryAuth(url, config, shownUrl = url) {
  if (config.auth !== 'query') return { url, shownUrl, credentialInUrl: false };
  if (looksLikeSecretRef(config._token) || (!config._token && looksLikeSecretRef(config.token))) {
    throw new UnresolvedSecretError('the token in the URL', { token: true });
  }
  if (config._token) {
    const paramName = config.queryParam || 'apikey';
    const separator = url.includes('?') ? '&' : '?';
    return {
      url: `${url}${separator}${paramName}=${encodeURIComponent(config._token)}`,
      shownUrl: `${shownUrl}${separator}${paramName}={token}`,
      credentialInUrl: true,
    };
  }
  return { url, shownUrl, credentialInUrl: false };
}

/**
 * Whether a data request carries the integration's own credentials: an auth
 * header from buildAuthHeaders, or a key in the URL. A 401 or 403 to such a
 * request is a rejected login (#239), which the refresh loop does not repeat
 * until the config changes; one to a request without them is not.
 */
function carriesCredentials(config, credentialInUrl) {
  if (credentialInUrl) return true;
  switch (config.auth) {
    case 'basic':
      return !!(config._username || config._password);
    case 'bearer':
    case 'header':
      return !!config._token;
    default:
      return false;
  }
}

// Re-exported for back-compat; SSRF is also enforced at the fetch chokepoint in
// lib/http.js, so every auth path is guarded by construction.
export { resolveIntegrationConfig };
export { assertSafeUrl };

// ── Main fetch function for any integration ──
/**
 * Fetch one integration and return its fields, or `{ error }`, plus
 * `authRejected: true` when the upstream refused its credentials (#239).
 *
 * @param {string} type preset type, or the storage key of a custom integration
 * @param {object} yamlConfig its services.yaml entry, with `_storageKey`
 * @param {object | null} [resolved] the config resolveIntegrationConfig returns
 *   for these two, when the caller already has it: the refresh loop resolves an
 *   integration once a cycle for its backoff fingerprint and hands that over, so
 *   its credentials are not read from the secrets store twice. Omitted, it is
 *   resolved here.
 */
export async function fetchIntegration(type, yamlConfig, resolved) {
  const config = resolved === undefined ? resolveIntegrationConfig(type, yamlConfig) : resolved;
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
      const endpoint = resolveEndpoint(config.endpoint, config);
      const { url, shownUrl, credentialInUrl } =
        applyQueryAuth(`${baseUrl}${endpoint.path}`, config, `${baseUrl}${endpoint.shownPath}`);

      const headers = buildAuthHeaders(config);
      const urlCarriesCredential = credentialInUrl || endpoint.credentialInUrl;
      const res = await safeFetch(url, { headers }, skipTls, { credentialInUrl: urlCarriesCredential, shownUrl });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
        if (isAuthRejection(res) && carriesCredentials(config, urlCarriesCredential)) err.authRejected = true;
        throw err;
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
          const { path, shownPath, credentialInUrl } = resolveEndpoint(ep.endpoint, config);
          const epRes = await safeFetch(`${baseUrl}${path}`, { headers }, skipTls,
            { credentialInUrl, shownUrl: `${baseUrl}${shownPath}` });
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

    return { fields, ...extra, error: null };

  } catch (err) {
    // Redact before logging AND returning: query-auth presets put the API key
    // in the URL, and fetch errors embed the full URL — never leak it.
    const safe = redactError(err);
    log.error({ type, error: safe }, 'fetch error');
    // authRejected (#239): the upstream refused the credentials, so the
    // refresh loop stops sending them until the config changes.
    return err?.authRejected ? { error: safe, fields: {}, authRejected: true } : { error: safe, fields: {} };
  }
}

// ── Test connection: lightweight check that URL + creds work ──
export async function testIntegration(type, testConfig) {
  const preset = getPresetFull(type);

  if (preset?.unsupported) {
    return { ok: false, error: `Integration unavailable: ${preset.unsupported}` };
  }

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
      const { url, shownUrl, credentialInUrl } = applyQueryAuth(`${baseUrl}${testEndpoint}`, config);
      const headers = buildAuthHeaders(config);
      const res = await safeFetch(url, { headers }, skipTls, { credentialInUrl, shownUrl });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
      return { ok: true, status: res.status };
    }
  } catch (err) {
    // A token typed into the form that looks like a `$secret:` reference: the
    // test sends what was typed and resolves nothing, so say that (#425).
    if (err instanceof UnresolvedSecretError) {
      return {
        ok: false,
        error: 'The token looks like a stored-secret reference, and the connection test sends the token as typed; type the token itself',
      };
    }
    return { ok: false, error: redactError(err) };
  }
}
