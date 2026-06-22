import { safeFetch } from './http.js';
import { extractValue, resolveEndpointParams } from './extract.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('integrations');

/**
 * Replace {username}/{password} placeholders structurally, then the caller
 * JSON.stringify's the result — so JSON.stringify escapes a quote/backslash in a
 * credential. Substituting into ALREADY-serialized JSON (the old approach) let a
 * credential containing `"` inject fields or break the login body.
 */
function fillCreds(value, username, password) {
  if (typeof value === 'string') {
    return value.replace('{username}', username).replace('{password}', password);
  }
  if (Array.isArray(value)) return value.map((v) => fillCreds(v, username, password));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = fillCreds(v, username, password);
    return out;
  }
  return value;
}

/**
 * Build the login request body from a session config + resolved credentials.
 * For form-urlencoded logins, fills the {username}/{password} placeholders in
 * the raw template string (URL-encoding each); otherwise structurally fills the
 * JSON body object and serializes it. Shared by doSessionLogin + testSessionAuth.
 */
function buildLoginBody(session, config) {
  const contentType = session.loginContentType || 'application/json';
  if (contentType === 'application/x-www-form-urlencoded') {
    return (typeof session.loginBody === 'string' ? session.loginBody : '')
      .replace('{username}', encodeURIComponent(config._username || ''))
      .replace('{password}', encodeURIComponent(config._password || ''));
  }
  return JSON.stringify(fillCreds(session.loginBody, config._username || '', config._password || ''));
}

/**
 * Session-based authentication: log in once, cache the token, reuse it on
 * subsequent fetches until expiry, transparently re-authenticate if the cached
 * token gets rejected.
 *
 * Two cache eviction triggers:
 *   1. Time-based — entry expires after `tokenTtl` ms (configurable per preset
 *      via session.tokenTtl, defaults to 1 hour).
 *   2. Server rejection — if a fetch with the cached token fails for any reason,
 *      we drop the cache entry and re-auth. Failures are logged so transient
 *      network issues are distinguishable from real token expiry in the logs.
 */

// Token cache — key: baseUrl + loginEndpoint, value: { token, header, prefix, expires }
// Capped at SESSION_CACHE_MAX entries with simple LRU eviction (Map preserves
// insertion order; on access we delete + re-set to bump the entry to the tail).
// Without this cap, a misconfigured caller that varies the cache key (e.g.
// rotating loginEndpoint paths) could grow the Map unbounded.
const sessionTokenCache = new Map();
const SESSION_CACHE_MAX = 100;

function cacheGet(key) {
  const entry = sessionTokenCache.get(key);
  if (!entry) return undefined;
  // Bump to MRU position.
  sessionTokenCache.delete(key);
  sessionTokenCache.set(key, entry);
  return entry;
}

function cacheSet(key, value) {
  if (sessionTokenCache.has(key)) {
    sessionTokenCache.delete(key);
  } else if (sessionTokenCache.size >= SESSION_CACHE_MAX) {
    const oldest = sessionTokenCache.keys().next().value;
    if (oldest !== undefined) sessionTokenCache.delete(oldest);
  }
  sessionTokenCache.set(key, value);
}

// Conservative default — most APIs hand out tokens that last at least an hour.
// Per-preset override via session.tokenTtl (milliseconds).
const SESSION_TOKEN_TTL_DEFAULT = 3_600_000;

// Exported only for tests.
export const __test = { sessionTokenCache, cacheGet, cacheSet, SESSION_CACHE_MAX };

/**
 * Run a fetch using session-based auth.
 *
 * Tries primary session config first, then any fallback (e.g. for services
 * that support multiple auth modes like Proxmox API token vs PVE cookie).
 */
export async function fetchWithSession(config) {
  const session = config.session;
  if (!session) throw new Error('Session config missing');

  const baseUrl = config.url.replace(/\/+$/, '');
  const skipTls = !!config.tlsSkip;

  // Determine which session configs to try (primary, then fallback)
  const fallbackKey = config.authFallback;
  const fallbackSession = fallbackKey && config[fallbackKey];
  const sessionConfigs = [
    { key: 'primary', session },
    ...(fallbackSession ? [{ key: fallbackKey, session: fallbackSession }] : []),
  ];

  for (const { key, session: sess } of sessionConfigs) {
    const cacheKey = `${baseUrl}:${sess.loginEndpoint}`;
    const cached = cacheGet(cacheKey);

    // Try cached token first
    if (cached && Date.now() < cached.expires) {
      try {
        const data = await fetchWithToken(cached, config, baseUrl, skipTls);
        return data;
      } catch (fetchErr) {
        // Token might be expired server-side (or network blip / rate limit / DNS).
        // Drop the cache entry and fall through to fresh login. Logging here lets
        // us distinguish real token expiry from other transient failures.
        log.warn({ error: fetchErr.message }, 'Cached token fetch failed, retrying with fresh login');
        sessionTokenCache.delete(cacheKey);
      }
    }

    // Authenticate and cache the token
    try {
      const tokenInfo = await doSessionLogin(config, sess, baseUrl, skipTls);
      cacheSet(cacheKey, tokenInfo);
      const data = await fetchWithToken(tokenInfo, config, baseUrl, skipTls);
      return data;
    } catch (err) {
      log.warn({ key, error: err.message }, 'session auth failed');
      continue;
    }
  }

  // All auth methods failed
  const instructions = config.oauth2Instructions || '';
  throw new Error(
    instructions
      ? `Authentication failed. ${instructions}`
      : 'All session auth methods failed'
  );
}

/** Login and return token info (without fetching data). */
async function doSessionLogin(config, session, baseUrl, skipTls) {
  const contentType = session.loginContentType || 'application/json';
  const loginBody = buildLoginBody(session, config);

  const loginRes = await safeFetch(`${baseUrl}${session.loginEndpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: loginBody,
  }, skipTls);

  if (!loginRes.ok) {
    throw new Error(`Login returned HTTP ${loginRes.status}`);
  }

  let loginData;
  try {
    const text = await loginRes.text();
    loginData = JSON.parse(text);
  } catch (parseErr) {
    throw new Error(`Login response is not valid JSON: ${parseErr.message}`);
  }

  const token = extractValue(loginData, session.tokenPath);
  if (!token) throw new Error('Login succeeded but no token in response');

  // Per-preset TTL override; fall back to module default.
  const ttlMs = session.tokenTtl || SESSION_TOKEN_TTL_DEFAULT;

  return {
    token,
    header: session.tokenHeader,
    prefix: session.tokenPrefix || '',
    expires: Date.now() + ttlMs,
  };
}

/** Fetch data using a cached token. */
async function fetchWithToken(tokenInfo, config, baseUrl, skipTls) {
  const headers = {};
  if (tokenInfo.header) {
    headers[tokenInfo.header] = tokenInfo.prefix + tokenInfo.token;
  }
  if (config.extraHeaders) Object.assign(headers, config.extraHeaders);

  const res = await safeFetch(
    `${baseUrl}${resolveEndpointParams(config.endpoint, config)}`,
    { headers },
    skipTls,
  );
  if (!res.ok) throw new Error(`Data fetch returned HTTP ${res.status}`);
  return res.json();
}

/**
 * Test a single session auth attempt.
 *
 * Used by testIntegration() — returns { ok, status?, error? } instead of
 * throwing, so the caller can try fallback auth methods sequentially.
 */
export async function testSessionAuth(config, session, baseUrl, skipTls) {
  try {
    const contentType = session.loginContentType || 'application/json';
    const loginBody = buildLoginBody(session, config);

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
