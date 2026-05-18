/**
 * JagHelm Integration Handler
 *
 * Generic pipeline: resolve config → authenticate → fetch → transform → cache.
 *
 * Supports auth types: none, basic, bearer, header, query, session
 * Supports field formats: number, decimal, percent, ms, bytes, duration, string
 * Supports compute types: percent_of, subtract, sum
 *
 * All integrations — both presets and custom — flow through this single handler.
 *
 * Architecture:
 *   ./lib/cache.js     — in-memory response cache + TTL
 *   ./lib/http.js      — safeFetch wrapper (per-request undici dispatcher for TLS skip)
 *   ./lib/extract.js   — JSON path DSL (extractValue, _filter:, _length) + URL templating
 *   ./lib/format.js    — formatValue + computeField
 *   ./lib/auth.js      — buildAuthHeaders for non-session auth
 *   ./lib/session.js   — session token cache + login + token reuse
 *   ./lib/config.js    — credential resolution and config merging
 *
 * This file owns the two top-level orchestrators: fetchIntegration (the data
 * pipeline) and testIntegration (the connection-test pipeline).
 */

import { getPresetFull } from './registry.js';

import { getCached, setCache } from './lib/cache.js';
import { safeFetch } from './lib/http.js';
import { extractValue, resolveEndpointParams } from './lib/extract.js';
import { formatValue, computeField } from './lib/format.js';
import { buildAuthHeaders } from './lib/auth.js';
import { fetchWithSession, testSessionAuth } from './lib/session.js';
import { resolveIntegrationConfig } from './lib/config.js';

// Re-export so the public API of handler.js is unchanged.
export { resolveIntegrationConfig };

// ── SSRF guard ────────────────────────────────────────────────────────────
// JagHelm is a homelab dashboard — private/loopback hosts ARE the legitimate
// integration targets (192.168/16 Proxmox, 10/8 NAS, localhost services, etc.).
// So by default we only block the things that have no legitimate use case:
//   - non-http(s) schemes (file:, gopher:, ftp:, data:, …)
//   - cloud-instance metadata endpoint 169.254.169.254 (AWS/GCP/Azure)
//   - 0.0.0.0 (this-network)
//
// Strict mode (multi-tenant deployments): set JAGHELM_BLOCK_PRIVATE_NETWORKS=true
// to additionally block all RFC1918 + loopback + link-local + ULA ranges.
//
// Residual risk: DNS rebinding — a public hostname can resolve to a private
// IP at fetch time. Mitigating that requires re-resolving and pinning the
// socket, which Node's global fetch doesn't expose cleanly. Acceptable for
// homelab use; revisit if deploying with untrusted-user integration configs.
const PRIVATE_V4_RANGES = [
  /^127\./,                              // 127/8 loopback
  /^10\./,                               // 10/8
  /^192\.168\./,                         // 192.168/16
  /^169\.254\./,                         // 169.254/16 link-local
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,      // 172.16/12
];

function isPrivateV4(ip) {
  return PRIVATE_V4_RANGES.some(re => re.test(ip));
}

function isPrivateV6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  // fc00::/7 unique-local + fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
  // IPv4-mapped IPv6 — both forms:
  //   - dotted-quad: "::ffff:127.0.0.1"
  //   - hex-normalized (what WHATWG URL emits): "::ffff:7f00:1"
  const dottedMapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMapped && isPrivateV4(dottedMapped[1])) return true;
  const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    if (isPrivateV4(`${a}.${b}.${c}.${d}`)) return true;
  }
  return false;
}

function strictMode() {
  return String(process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS || '').toLowerCase() === 'true';
}

export function assertSafeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`);
  }
  // Strip the brackets URL parsing leaves on v6 literals (e.g. "[::1]" → "::1").
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host === '') {
    throw new Error('Blocked host: (empty)');
  }
  const isIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  // Always block cloud-metadata IP and 0/8 "this network" (no legitimate use).
  if (host === '169.254.169.254' || (isIPv4 && /^0\./.test(host))) {
    throw new Error(`Blocked host: ${host}`);
  }
  if (!strictMode()) {
    return;
  }
  // Strict mode: block all private/loopback/link-local/ULA.
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error(`Blocked host: ${host}`);
  }
  if (isIPv4) {
    if (isPrivateV4(host)) {
      throw new Error(`Blocked private IPv4 host: ${host}`);
    }
    return;
  }
  if (host.includes(':')) {
    if (isPrivateV6(host)) {
      throw new Error(`Blocked private IPv6 host: ${host}`);
    }
    return;
  }
  // Bare hostname — left to DNS at fetch time (see residual-risk note above).
}

// ── Main fetch function for any integration ──
export async function fetchIntegration(type, yamlConfig, bustCache = false) {
  const cacheKey = `integration:${type}`;

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

      // Query param auth
      if (config.auth === 'query' && config._token) {
        const paramName = config.queryParam || 'apikey';
        const separator = url.includes('?') ? '&' : '?';
        url = `${url}${separator}${paramName}=${config._token}`;
      }

      const headers = buildAuthHeaders(config);
      assertSafeUrl(url);
      const res = await safeFetch(url, { headers }, skipTls);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
      }
      rawData = await res.json();
    }

    // Multi-endpoint support: if preset defines extraEndpoints, fetch them in parallel.
    // extraEndpoints can be an array or a function(rawData) that returns an array.
    // This allows dynamic endpoints that depend on primary response data
    // (e.g. Proxmox extracts node name from VMs, then fetches /nodes/{node}/tasks).
    // Results are attached to rawData._extra = { key1: data1, key2: data2 }
    const extraEpDef = config.extraEndpoints;
    const extraEps = typeof extraEpDef === 'function' ? extraEpDef(rawData) :
                     Array.isArray(extraEpDef) ? extraEpDef : null;
    if (extraEps && extraEps.length > 0) {
      const headers = buildAuthHeaders(config);
      const extraResults = await Promise.allSettled(
        extraEps.map(async (ep) => {
          const resolvedEp = resolveEndpointParams(ep.endpoint, config);
          const epUrl = `${baseUrl}${resolvedEp}`;
          assertSafeUrl(epUrl);
          const epRes = await safeFetch(epUrl, { headers }, skipTls);
          if (!epRes.ok) {
            throw new Error(`HTTP ${epRes.status} ${epRes.statusText || ''}`.trim());
          }
          return { key: ep.key, data: await epRes.json() };
        })
      );
      rawData._extra = {};
      for (const r of extraResults) {
        if (r.status === 'fulfilled' && r.value) {
          rawData._extra[r.value.key] = r.value.data;
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
    console.error(`[integrations] ${type} fetch error:`, err.message);
    return { error: err.message, fields: {} };
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
      let url = `${baseUrl}${testEndpoint}`;
      if (config.auth === 'query' && config._token) {
        const paramName = config.queryParam || 'apikey';
        const separator = url.includes('?') ? '&' : '?';
        url = `${url}${separator}${paramName}=${config._token}`;
      }
      const headers = buildAuthHeaders(config);
      assertSafeUrl(url);
      const res = await safeFetch(url, { headers }, skipTls);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
      return { ok: true, status: res.status };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
