/**
 * JagHelm Integration Handler
 * 
 * Generic pipeline: resolve config → authenticate → fetch → transform → cache
 * 
 * Supports auth types: none, basic, bearer, header, query, session
 * Supports field formats: number, decimal, percent, ms, bytes, duration, string
 * Supports compute types: percent_of, subtract, sum
 * 
 * All integrations — both presets and custom — flow through this single handler.
 */

import { getPresetFull } from './registry.js';
import { resolveCredential, getSecret } from '../secrets.js';

// ── Simple in-memory cache (shared with server/index.js pattern) ──
const cache = new Map();
const CACHE_TTL = 30_000; // 30 seconds

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ── Safe fetch with timeout + optional TLS skip for self-signed certs ──
// SECURITY NOTE: TLS skip uses process.env.NODE_TLS_REJECT_UNAUTHORIZED which is
// process-global. Node 22's built-in fetch (undici) does not expose a per-request
// dispatcher for custom TLS settings without adding undici as an explicit dependency.
// This is acceptable because: (1) only Proxmox uses tlsSkip, (2) it's toggled
// on/off synchronously around the await, and (3) the window is limited to the
// single fetch call duration. A future Node version or explicit undici dependency
// would allow a proper per-request dispatcher.
async function safeFetch(url, opts = {}, skipTls = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const fetchOpts = { ...opts, signal: controller.signal };
    if (skipTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const res = await fetch(url, fetchOpts);
    return res;
  } finally {
    if (skipTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
    clearTimeout(timeout);
  }
}

// ── Replace {placeholder} tokens in endpoint URLs with config values ──
// Used by presets that require dynamic URL segments (e.g. Cloudflare account_id).
// Looks up the key in config directly, then falls back to _prefixed version.
function resolveEndpointParams(endpoint, config) {
  return endpoint.replace(/\{(\w+)\}/g, (match, key) => {
    return config[key] || config[`_${key}`] || match;
  });
}

// ── Deep value extraction from JSON using dot-notation path ──
// Supports: 'foo.bar.baz', 'foo.0.bar' (array index), '_length' (array length)
function extractValue(data, path) {
  if (!path || !data) return undefined;

  // Special: array length
  if (path === '_length') {
    return Array.isArray(data) ? data.length : 0;
  }

  // Special: array filter — '_filter:field=value' or '_filter:field>value'
  if (path.startsWith('_filter:')) {
    const filterExpr = path.slice(8);
    if (!Array.isArray(data)) return 0;

    // Parse operator: =, >, <, >=, <=
    let field, op, value;
    for (const operator of ['>=', '<=', '>', '<', '=']) {
      const idx = filterExpr.indexOf(operator);
      if (idx > 0) {
        field = filterExpr.slice(0, idx);
        op = operator;
        value = filterExpr.slice(idx + operator.length);
        break;
      }
    }
    if (!field) return 0;

    const numVal = Number(value);
    const isNumeric = !isNaN(numVal);
    return data.filter(item => {
      const itemVal = item[field];
      if (itemVal == null) return false;
      switch (op) {
        case '=': return isNumeric ? itemVal == numVal : String(itemVal) === value;
        case '>': return itemVal > numVal;
        case '<': return itemVal < numVal;
        case '>=': return itemVal >= numVal;
        case '<=': return itemVal <= numVal;
        default: return false;
      }
    }).length;
  }

  // Standard dot-notation traversal
  const parts = path.split('.');
  let current = data;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

// ── Format a raw value according to field format ──
function formatValue(raw, format) {
  if (raw == null || raw === undefined) return '—';

  switch (format) {
    case 'number':
      return typeof raw === 'number' ? raw.toLocaleString() : String(raw);
    case 'decimal':
      return typeof raw === 'number' ? raw.toFixed(1) : String(raw);
    case 'percent':
      return typeof raw === 'number' ? `${raw.toFixed(1)}%` : String(raw);
    case 'ms':
      // Input is typically seconds, convert to ms
      return typeof raw === 'number' ? `${Math.round(raw * 1000)}ms` : String(raw);
    case 'bytes': {
      if (typeof raw !== 'number') return String(raw);
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let val = raw;
      let i = 0;
      while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
      return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }
    case 'duration': {
      if (typeof raw !== 'number') return String(raw);
      const h = Math.floor(raw / 3600);
      const m = Math.floor((raw % 3600) / 60);
      if (h > 0) return `${h}h ${m}m`;
      if (m > 0) return `${m}m`;
      return `${Math.round(raw)}s`;
    }
    case 'string':
    default:
      return String(raw);
  }
}

// ── Compute derived fields ──
function computeField(data, field) {
  switch (field.compute) {
    case 'percent_of': {
      const num = extractValue(data, field.numerator);
      const den = extractValue(data, field.denominator);
      if (typeof num !== 'number' || typeof den !== 'number' || den === 0) return '0%';
      return `${((num / den) * 100).toFixed(1)}%`;
    }
    case 'subtract': {
      const a = extractValue(data, field.a);
      const b = extractValue(data, field.b);
      if (typeof a !== 'number' || typeof b !== 'number') return '—';
      return formatValue(a - b, field.format || 'number');
    }
    case 'sum': {
      const paths = field.paths || [];
      const total = paths.reduce((acc, p) => {
        const v = extractValue(data, p);
        return acc + (typeof v === 'number' ? v : 0);
      }, 0);
      return formatValue(total, field.format || 'number');
    }
    default:
      return '—';
  }
}

// ── Resolve integration config from services.yaml + secrets ──
// Merges: preset defaults < services.yaml config < .env overrides
export function resolveIntegrationConfig(type, yamlConfig) {
  const preset = getPresetFull(type);

  // For custom integrations (no preset), yamlConfig IS the full config
  const config = preset ? { ...preset, ...yamlConfig } : yamlConfig;
  if (!config) return null;

  // Use storage key for secret resolution (e.g. adguard_secondary instead of adguard)
  const secretKey = yamlConfig?._storageKey || type;

  // Resolve credentials
  const resolved = { ...config };

  if (preset?.envKeys) {
    // URL: .env > yaml > null
    if (preset.envKeys.url) {
      resolved.url = resolveCredential(preset.envKeys.url, `integration_${secretKey}_url`) || config.url;
    }
    // Username: .env > yaml > null
    if (preset.envKeys.username) {
      resolved._username = resolveCredential(preset.envKeys.username, `integration_${secretKey}_username`) || config.username;
    }
    // Password: .env > yaml ($secret:ref) > null
    if (preset.envKeys.password) {
      resolved._password = resolveCredential(preset.envKeys.password, `integration_${secretKey}_password`) || resolveSecretRef(config.password);
    }
    // Token: .env > yaml ($secret:ref) > null
    if (preset.envKeys.token) {
      resolved._token = resolveCredential(preset.envKeys.token, `integration_${secretKey}_token`) || resolveSecretRef(config.token);
    }
  } else {
    // Custom integration — resolve $secret: refs in credentials
    resolved._username = config.username;
    resolved._password = resolveSecretRef(config.password);
    resolved._token = resolveSecretRef(config.token);
  }

  return resolved;
}

// Resolve $secret:key_name references to decrypted values
function resolveSecretRef(value) {
  if (!value || typeof value !== 'string') return value;
  if (value.startsWith('$secret:')) {
    return getSecret(value.slice(8)) || null;
  }
  return value;
}

// ── Build auth headers for a request ──
function buildAuthHeaders(config) {
  const headers = {};

  // Add any extra headers from preset
  if (config.extraHeaders) {
    Object.assign(headers, config.extraHeaders);
  }

  switch (config.auth) {
    case 'basic': {
      const u = config._username || '';
      const p = config._password || '';
      if (u || p) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
      }
      break;
    }
    case 'bearer': {
      const token = config._token || '';
      if (token) headers['Authorization'] = `Bearer ${token}`;
      break;
    }
    case 'header': {
      const headerName = config.authHeader || 'X-API-Key';
      const prefix = config.authPrefix || '';
      const token = config._token || '';
      if (token) headers[headerName] = prefix + token;
      break;
    }
    case 'query':
      // Query param auth is handled in URL construction, not headers
      break;
    case 'session':
      // Session auth requires a login step — handled in fetchWithSession()
      break;
    case 'none':
    default:
      break;
  }

  return headers;
}

// ── Session-based auth: login first, then fetch ──
async function fetchWithSession(config) {
  const session = config.session;
  if (!session) throw new Error('Session config missing');

  const baseUrl = config.url.replace(/\/+$/, '');
  const skipTls = !!config.tlsSkip;

  // Try primary session auth first
  try {
    const data = await doSessionFetch(config, session, baseUrl, skipTls);
    return data;
  } catch (primaryErr) {
    console.warn(`[integrations] Primary session auth failed: ${primaryErr.message}`);
    // If a fallback auth method is defined, try it
    const fallbackKey = config.authFallback;
    const fallbackSession = fallbackKey && config[fallbackKey];
    if (fallbackSession) {
      try {
        console.log(`[integrations] Trying ${fallbackKey} fallback auth...`);
        return await doSessionFetch(config, fallbackSession, baseUrl, skipTls);
      } catch (fallbackErr) {
        console.error(`[integrations] Fallback auth also failed: ${fallbackErr.message}`);
        // Both failed — throw with instructions if available
        const instructions = config.oauth2Instructions || '';
        throw new Error(
          instructions
            ? `Authentication failed. ${instructions}`
            : `Session auth failed: ${primaryErr.message}. Fallback also failed: ${fallbackErr.message}`
        );
      }
    }
    throw primaryErr;
  }
}

// ── Perform a single session auth + fetch cycle ──
async function doSessionFetch(config, session, baseUrl, skipTls) {
  // Step 1: Login
  const contentType = session.loginContentType || 'application/json';
  let loginBody;
  if (contentType === 'application/x-www-form-urlencoded') {
    loginBody = (typeof session.loginBody === 'string' ? session.loginBody : '')
      .replace('{username}', encodeURIComponent(config._username || ''))
      .replace('{password}', encodeURIComponent(config._password || ''));
  } else {
    loginBody = JSON.stringify(session.loginBody)
      .replace('{username}', config._username || '')
      .replace('{password}', config._password || '');
  }

  const loginRes = await safeFetch(`${baseUrl}${session.loginEndpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: loginBody,
  }, skipTls);

  if (!loginRes.ok) {
    throw new Error(`Login returned HTTP ${loginRes.status}`);
  }

  const loginData = await loginRes.json();
  const token = extractValue(loginData, session.tokenPath);
  if (!token) throw new Error('Login succeeded but no token in response');

  // Step 2: Fetch with session token
  const headers = {};
  if (session.tokenHeader) {
    headers[session.tokenHeader] = (session.tokenPrefix || '') + token;
  }
  if (config.extraHeaders) Object.assign(headers, config.extraHeaders);

  const res = await safeFetch(`${baseUrl}${resolveEndpointParams(config.endpoint, config)}`, { headers }, skipTls);
  return res.json();
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
      const res = await safeFetch(url, { headers }, skipTls);
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
          const epRes = await safeFetch(epUrl, { headers }, skipTls);
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
      const res = await safeFetch(url, { headers }, skipTls);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
      return { ok: true, status: res.status };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Test a single session auth attempt ──
async function testSessionAuth(config, session, baseUrl, skipTls) {
  try {
    const contentType = session.loginContentType || 'application/json';
    let loginBody;
    if (contentType === 'application/x-www-form-urlencoded') {
      loginBody = (typeof session.loginBody === 'string' ? session.loginBody : '')
        .replace('{username}', encodeURIComponent(config._username || ''))
        .replace('{password}', encodeURIComponent(config._password || ''));
    } else {
      loginBody = JSON.stringify(session.loginBody)
        .replace('{username}', config._username || '')
        .replace('{password}', config._password || '');
    }

    const res = await safeFetch(`${baseUrl}${session.loginEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: loginBody,
    }, skipTls);

    if (!res.ok) return { ok: false, error: `Login failed: HTTP ${res.status}` };
    const data = await res.json();
    const token = extractValue(data, session.tokenPath);
    if (!token) return { ok: false, error: 'Login succeeded but no token in response' };
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

