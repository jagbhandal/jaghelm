import { safeFetch } from './http.js';
import { extractValue, resolveEndpointParams } from './extract.js';

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
const sessionTokenCache = new Map();

// Conservative default — most APIs hand out tokens that last at least an hour.
// Per-preset override via session.tokenTtl (milliseconds).
const SESSION_TOKEN_TTL_DEFAULT = 3_600_000;

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
    const cached = sessionTokenCache.get(cacheKey);

    // Try cached token first
    if (cached && Date.now() < cached.expires) {
      try {
        const data = await fetchWithToken(cached, config, baseUrl, skipTls);
        return data;
      } catch (fetchErr) {
        // Token might be expired server-side (or network blip / rate limit / DNS).
        // Drop the cache entry and fall through to fresh login. Logging here lets
        // us distinguish real token expiry from other transient failures.
        console.warn(`[integrations] Cached token fetch failed (${fetchErr.message}), retrying with fresh login`);
        sessionTokenCache.delete(cacheKey);
      }
    }

    // Authenticate and cache the token
    try {
      const tokenInfo = await doSessionLogin(config, sess, baseUrl, skipTls);
      sessionTokenCache.set(cacheKey, tokenInfo);
      const data = await fetchWithToken(tokenInfo, config, baseUrl, skipTls);
      return data;
    } catch (err) {
      console.warn(`[integrations] ${key} session auth failed: ${err.message}`);
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
