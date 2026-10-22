import { safeFetch, isAuthRejection, readJson } from './http.js';
import { extractValue, resolveEndpoint } from './extract.js';
import { createLogger } from '../../util/logger.js';
import { redactSecrets } from '../../util/redact.js';
import { assertCredentialOrigin } from './origin.js';

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
 * JSON body object and serializes it.
 */
function buildLoginBody(session, config) {
  const contentType = session.loginContentType || 'application/json';
  const body =
    contentType === 'application/x-www-form-urlencoded'
      ? (typeof session.loginBody === 'string' ? session.loginBody : '')
          .replace(/\{username\}/g, encodeURIComponent(config._username || ''))
          .replace(/\{password\}/g, encodeURIComponent(config._password || ''))
      : JSON.stringify(fillCreds(session.loginBody, config._username || '', config._password || ''));
  return { body, contentType };
}

// Session-auth token cache — key: baseUrl + loginEndpoint, value:
// { token, header, prefix, expires }. Evicted on TTL expiry or server rejection
// (re-auth on either). Capped at SESSION_CACHE_MAX with LRU eviction (Map keeps
// insertion order; access bumps to the tail): without the cap, a caller that
// varies the key (e.g. rotating loginEndpoint paths) could grow it unbounded.
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
 *
 * `cache: false` (the connection test, #427) logs in afresh and keeps no
 * token: a cached token would pass a test of a password that is wrong, and a
 * token from an unsaved password would serve the refresh.
 */
export async function fetchWithSession(config, { cache = true } = {}) {
  const session = config.session;
  if (!session) throw new Error('Session config missing');

  const baseUrl = config.url.replace(/\/+$/, '');
  const skipTls = !!config.tlsSkip;
  // Filled in before any login: an endpoint needing a stored credential that
  // doesn't resolve throws here (#425), so no login is sent for a read that
  // can't be made.
  const endpoint = resolveEndpoint(config.endpoint, config);

  // Determine which session configs to try (primary, then fallback)
  const fallbackKey = config.authFallback;
  const fallbackSession = fallbackKey && config[fallbackKey];
  const sessionConfigs = [
    { key: 'primary', session },
    ...(fallbackSession ? [{ key: fallbackKey, session: fallbackSession }] : []),
  ];
  // A stored credential goes only where it was entered (#556): every login
  // and the read after it, checked before any is sent. The read carries the
  // token the login answers, which stands for the credential.
  for (const { session: sess } of sessionConfigs) {
    assertCredentialOrigin(config, `${baseUrl}${sess.loginEndpoint}`);
  }
  assertCredentialOrigin(config, `${baseUrl}${endpoint.path}`);

  // Logins the upstream refused with a 401 or 403 (#239). Only when every
  // method's login was refused is the failure a rejected login, which the
  // refresh loop does not repeat until the config changes; a data read refused
  // after a good login, or a login that failed another way, is retried.
  let rejectedLogins = 0;
  // Why the last method failed, for the error (redacted): a test, and the
  // card, say why the login failed, not only that it did.
  let lastFailure = '';

  for (const { key, session: sess } of sessionConfigs) {
    const cacheKey = `${baseUrl}:${sess.loginEndpoint}`;
    const cached = cache ? cacheGet(cacheKey) : undefined;

    // Try cached token first
    if (cached && Date.now() < cached.expires) {
      try {
        const data = await fetchWithToken(cached, endpoint, config, baseUrl, skipTls);
        return data;
      } catch (fetchErr) {
        // Cached token rejected (expiry or transient blip): drop it and re-login. Logged to tell the two apart.
        log.warn({ error: fetchErr.message }, 'Cached token fetch failed, retrying with fresh login');
        sessionTokenCache.delete(cacheKey);
      }
    }

    // Authenticate and cache the token
    try {
      const tokenInfo = await doSessionLogin(config, sess, baseUrl, skipTls);
      if (cache) cacheSet(cacheKey, tokenInfo);
      const data = await fetchWithToken(tokenInfo, endpoint, config, baseUrl, skipTls);
      return data;
    } catch (err) {
      if (err.authRejected) rejectedLogins += 1;
      log.warn({ key, error: err.message }, 'session auth failed');
      lastFailure = redactSecrets(err.message || String(err));
      continue;
    }
  }

  // All auth methods failed
  const instructions = config.oauth2Instructions || '';
  const reason = lastFailure ? `: ${lastFailure}` : '';
  const err = new Error(
    instructions
      ? `Authentication failed${reason}. ${instructions}`
      : `All session auth methods failed${reason}`
  );
  if (rejectedLogins === sessionConfigs.length) err.authRejected = true;
  throw err;
}

/** Login and return token info (without fetching data). */
async function doSessionLogin(config, session, baseUrl, skipTls) {
  const { body, contentType } = buildLoginBody(session, config);

  const loginRes = await safeFetch(`${baseUrl}${session.loginEndpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  }, skipTls);

  if (!loginRes.ok) {
    const err = new Error(`Login returned HTTP ${loginRes.status}`);
    if (isAuthRejection(loginRes)) err.authRejected = true;
    throw err;
  }

  // Not JSON: says so, never quoting the reply (readJson).
  const loginData = await readJson(loginRes);

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

/**
 * Fetch data using a cached token, from `endpoint`: resolveEndpoint's answer
 * for the integration's endpoint, worked out once before any login.
 */
async function fetchWithToken(tokenInfo, endpoint, config, baseUrl, skipTls) {
  const headers = {};
  if (tokenInfo.header) {
    headers[tokenInfo.header] = tokenInfo.prefix + tokenInfo.token;
  }
  if (config.extraHeaders) Object.assign(headers, config.extraHeaders);

  const { path, shownPath, credentialInUrl } = endpoint;
  const res = await safeFetch(`${baseUrl}${path}`, { headers }, skipTls,
    { credentialInUrl, shownUrl: `${baseUrl}${shownPath}` });
  if (!res.ok) throw new Error(`Data fetch returned HTTP ${res.status}`);
  return readJson(res);
}
