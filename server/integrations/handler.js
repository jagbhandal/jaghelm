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
import { Agent } from 'undici';

// ── TLS-skip agent for self-signed certs (Proxmox, etc.) ──
const tlsSkipAgent = new Agent({ connect: { rejectUnauthorized: false } });

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

// ── Safe fetch with timeout + optional TLS skip ──
async function safeFetch(url, opts = {}, skipTls = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const fetchOpts = { ...opts, signal: controller.signal };
    if (skipTls) fetchOpts.dispatcher = tlsSkipAgent;
    const res = await fetch(url, fetchOpts);
    return res;
  } finally {
    clearTimeout(timeout);
  }
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

  // Resolve credentials
  const resolved = { ...config };

  if (preset?.envKeys) {
    // URL: .env > yaml > null
    if (preset.envKeys.url) {
      resolved.url = resolveCredential(preset.envKeys.url, `integration_${type}_url`) || config.url;
    }
    // Username: .env > yaml > null
    if (preset.envKeys.username) {
      resolved._username = resolveCredential(preset.envKeys.username, `integration_${type}_username`) || config.username;
    }
    // Password: .env > yaml ($secret:ref) > null
    if (preset.envKeys.password) {
      resolved._password = resolveCredential(preset.envKeys.password, `integration_${type}_password`) || resolveSecretRef(config.password);
    }
    // Token: .env > yaml ($secret:ref) > null
    if (preset.envKeys.token) {
      resolved._token = resolveCredential(preset.envKeys.token, `integration_${type}_token`) || resolveSecretRef(config.token);
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

  // Step 1: Login
  const loginBody = JSON.stringify(session.loginBody)
    .replace('{username}', config._username || '')
    .replace('{password}', config._password || '');

  const loginRes = await safeFetch(`${baseUrl}${session.loginEndpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: loginBody,
  }, skipTls);
  const loginData = await loginRes.json();
  const token = extractValue(loginData, session.tokenPath);
  if (!token) throw new Error('Session login failed — no token in response');

  // Step 2: Fetch with session token
  const headers = {};
  if (session.tokenHeader) {
    headers[session.tokenHeader] = (session.tokenPrefix || '') + token;
  }
  if (config.extraHeaders) Object.assign(headers, config.extraHeaders);

  const res = await safeFetch(`${baseUrl}${config.endpoint}`, { headers }, skipTls);
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
      let url = `${baseUrl}${config.endpoint}`;

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
      // For session auth, just try to login
      const session = config.session;
      if (!session) return { ok: false, error: 'Session config missing in preset' };

      const loginBody = JSON.stringify(session.loginBody)
        .replace('{username}', config._username || '')
        .replace('{password}', config._password || '');

      const res = await safeFetch(`${baseUrl}${session.loginEndpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: loginBody,
      }, skipTls);

      if (!res.ok) return { ok: false, error: `Login failed: HTTP ${res.status}` };
      const data = await res.json();
      const token = extractValue(data, session.tokenPath);
      if (!token) return { ok: false, error: 'Login succeeded but no token in response' };
      return { ok: true, status: res.status };

    } else {
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
