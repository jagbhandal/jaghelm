// @ts-check
/**
 * Embed check (#269): does an app tab's own server let a browser show it inside
 * JagHelm? The page can't tell. A frame the app's headers refuse still fires
 * `load` in Chromium, and a cross-origin frame's headers can't be read from the
 * page, so a blocked app and a working one look the same to the client. The
 * server reads the two headers that decide it, X-Frame-Options and CSP
 * frame-ancestors, and works out what the browser will do with them.
 *
 * What it fetches, and how (the SSRF surface):
 * - The URL of an app tab in the saved display config, looked up by tab id
 *   (the request names a tab id, not a URL), or, for Settings' add form
 *   (#362, `checkUrl`), the address a signed-in user typed, which gets exactly
 *   the same treatment below (a signed-in user can already point
 *   /api/integrations/test at any address).
 * - One GET, with no cookie, no Authorization header and no URL credentials (a
 *   URL with a user or password is not checked). The body is never read.
 * - Redirects are followed only on the same host (hostname and port; the
 *   scheme may change, so http://app -> https://app is followed), at most
 *   MAX_HOPS, each hop through assertSafeUrl (http(s) only; never the metadata
 *   address, nor 0.0.0.0/8; private ranges too under
 *   JAGHELM_BLOCK_PRIVATE_NETWORKS).
 * - Only a 2xx answer is read. The request carries no cookie, so a 401 or 403
 *   (a proxy's login, a WAF challenge) or a 5xx (an app starting up) may not
 *   be what the signed-in browser gets; its headers say nothing about the app.
 * - EMBED_CHECK_TIMEOUT_MS for the whole exchange, every hop included.
 * - The answer is cached per tab: OK_TTL_MS for a read, FAIL_TTL_MS for a
 *   failure, and a "fresh" check (the Retry button) reuses an answer younger
 *   than FRESH_MIN_AGE_MS, so a client can't make it fetch in a loop. Past the
 *   cache, at most READS_PER_MINUTE reads a minute, all tabs together: a
 *   signed-in user who saves many tabs can't turn it into a fast port scanner
 *   (it answers "unreachable" or "timed out", like /api/integrations/test).
 *
 * The verdict is worked out per request against the page's own origin, which
 * the client sends: it is compared, never fetched.
 */
import { assertSafeUrl } from './util/ssrf.js';
import { createRateLimiter } from './util/rateLimiter.js';

export const EMBED_CHECK_TIMEOUT_MS = 3000;
const MAX_HOPS = 5;
const OK_TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 60_000;
const FRESH_MIN_AGE_MS = 5_000;
const MAX_ENTRIES = 64;
const READS_PER_MINUTE = 30;
const HEADER_MAX = 200; // longest header value passed back to the page

const NOT_CHECKABLE = 'not an http(s) URL without credentials';

/**
 * @typedef {{ ok: true, finalUrl: string, xfo: string | null, csp: string | null }
 *   | { ok: false, reason: string }} FrameHeaders
 */

/** @param {URL} u */
function checkable(u) {
  return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
}

/**
 * Read the X-Frame-Options and Content-Security-Policy headers the app answers
 * a plain GET with, after same-host redirects. Never throws.
 * @param {string} rawUrl
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<FrameHeaders>}
 */
export async function readFrameHeaders(rawUrl, { timeoutMs = EMBED_CHECK_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: NOT_CHECKABLE };
  }
  if (!checkable(url)) return { ok: false, reason: NOT_CHECKABLE };
  const host = url.host; // hostname, and the port unless it is the default
  const signal = AbortSignal.timeout(timeoutMs);

  for (let hop = 0; ; hop++) {
    try {
      assertSafeUrl(url.href);
    } catch {
      return { ok: false, reason: 'refused' };
    }
    /** @type {Response} */
    let res;
    try {
      res = await fetchImpl(url.href, {
        method: 'GET',
        redirect: 'manual',
        // As a browser asks for a page; nothing that identifies the user.
        headers: { accept: 'text/html,application/xhtml+xml' },
        signal,
      });
    } catch {
      return { ok: false, reason: signal.aborted ? 'timed out' : 'unreachable' };
    }
    // The headers are all it needs: drop the body unread.
    res.body?.cancel().catch(() => {});
    const redirectTo = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!redirectTo) {
      if (res.status < 200 || res.status > 299) return { ok: false, reason: `answered ${res.status}` };
      return {
        ok: true,
        finalUrl: url.href,
        xfo: res.headers.get('x-frame-options'),
        csp: res.headers.get('content-security-policy'),
      };
    }
    if (hop >= MAX_HOPS) return { ok: false, reason: 'too many redirects' };
    let next;
    try {
      next = new URL(redirectTo, url);
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
    if (next.host !== host || !checkable(next)) {
      return { ok: false, reason: 'redirected to another host' };
    }
    url = next;
  }
}

// ── The verdict ───────────────────────────────────────────────────────────

const DEFAULT_PORT = /** @type {Record<string, string>} */ ({
  'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443',
});

/** @param {URL} u */
const portOf = (u) => u.port || DEFAULT_PORT[u.protocol] || '';

/** @param {string} value */
const clip = (value) => (value.length > HEADER_MAX ? `${value.slice(0, HEADER_MAX)}…` : value);

/**
 * CSP3 "scheme-part match": a source scheme also matches its secure upgrade.
 * @param {string} a the source's scheme, no colon
 * @param {string} b the URL's scheme, no colon
 */
function schemeMatches(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  return (
    a === b ||
    (a === 'http' && b === 'https') ||
    (a === 'ws' && (b === 'wss' || b === 'http' || b === 'https')) ||
    (a === 'wss' && b === 'https')
  );
}

const SCHEME_SOURCE = /^([a-z][a-z0-9+.-]*):$/i;
// [scheme://]host[:port][path]; host is *, *.name, or a name / IPv4 address.
const HOST_SOURCE = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d+|\*))?(?:\/.*)?$/i;

/**
 * Does the ancestor origin match one frame-ancestors source expression (CSP3
 * §6.7.2.8)? Paths are ignored: an ancestor is matched as an origin.
 * @param {string} expr
 * @param {URL} ancestor JagHelm's origin, as a URL
 * @param {URL} self the framed app's final URL
 */
function sourceMatches(expr, ancestor, self) {
  const scheme = ancestor.protocol.slice(0, -1);
  if (expr === '*') {
    return scheme === 'http' || scheme === 'https' || ancestor.protocol === self.protocol;
  }
  if (expr.toLowerCase() === "'self'") {
    if (ancestor.origin === self.origin) return true;
    // CSP3: the same host on the same port, or on each scheme's default port.
    return (
      ancestor.hostname === self.hostname &&
      (portOf(ancestor) === portOf(self) || (ancestor.port === '' && self.port === '')) &&
      (scheme === 'https' || scheme === 'wss' || (self.protocol === 'http:' && scheme === 'http'))
    );
  }
  const schemeOnly = SCHEME_SOURCE.exec(expr);
  if (schemeOnly) return schemeMatches(schemeOnly[1], scheme);
  const m = HOST_SOURCE.exec(expr);
  if (!m) return false; // a keyword, nonce or hash never names an ancestor
  const [, srcScheme, srcHost, srcPort] = m;
  if (srcScheme ? !schemeMatches(srcScheme, scheme) : !schemeMatches(self.protocol.slice(0, -1), scheme)) {
    return false;
  }
  const host = ancestor.hostname.toLowerCase();
  const want = srcHost.toLowerCase();
  if (want.startsWith('*')) {
    // "*" alone is a host of any name; "*.a.b" needs at least one more label.
    if (want !== '*' && !host.endsWith(want.slice(1))) return false;
  } else if (want !== host) {
    return false;
  }
  if (srcPort === '*') return true;
  if (srcPort === undefined) return ancestor.port === '';
  return srcPort === portOf(ancestor);
}

/**
 * The frame-ancestors source list of each policy in a Content-Security-Policy
 * header value that has one (CSP3 "parse a serialized CSP list"; a policy
 * keeps the first of a repeated directive).
 * @param {string | null} csp
 * @returns {string[][]}
 */
function frameAncestorLists(csp) {
  if (!csp) return [];
  /** @type {string[][]} */
  const lists = [];
  for (const policy of csp.split(',')) {
    for (const directive of policy.split(';')) {
      const tokens = directive.trim().split(/[\t\n\f\r ]+/).filter(Boolean);
      if (!tokens.length) continue;
      if (tokens[0].toLowerCase() === 'frame-ancestors') {
        lists.push(tokens.slice(1));
        break;
      }
    }
  }
  return lists;
}

/**
 * The HTML spec's X-Frame-Options decision: 'deny', 'sameorigin', or null when
 * the header doesn't restrict framing (absent, ALLOWALL, ALLOW-FROM, unknown).
 * @param {string | null} xfo
 */
function xfoDecision(xfo) {
  if (xfo === null) return null;
  const values = new Set(xfo.split(',').map((v) => v.trim().toLowerCase()));
  if (values.size > 1) {
    // Conflicting values: deny if any of them is a real one, else ignore.
    return ['deny', 'allowall', 'sameorigin'].some((v) => values.has(v)) ? 'deny' : null;
  }
  const [only] = values;
  return only === 'deny' || only === 'sameorigin' ? only : null;
}

/**
 * Will a browser show the app (its headers as read) inside a page on
 * `parentOrigin`? frame-ancestors, where present, replaces X-Frame-Options.
 * @param {{ finalUrl: string, xfo: string | null, csp: string | null }} headers
 * @param {string} parentOrigin
 * @returns {{ verdict: 'blocked', header: string } | { verdict: 'allowed' }}
 */
export function frameVerdict({ finalUrl, xfo, csp }, parentOrigin) {
  const self = new URL(finalUrl);
  const ancestor = new URL(parentOrigin);
  const lists = frameAncestorLists(csp);
  if (lists.length) {
    for (const list of lists) {
      if (!list.some((expr) => sourceMatches(expr, ancestor, self))) {
        const value = ['frame-ancestors', ...list].join(' ');
        return { verdict: 'blocked', header: `Content-Security-Policy: ${clip(value)}` };
      }
    }
    return { verdict: 'allowed' };
  }
  const decision = xfoDecision(xfo);
  if (decision === 'deny' || (decision === 'sameorigin' && ancestor.origin !== self.origin)) {
    return { verdict: 'blocked', header: `X-Frame-Options: ${clip(String(xfo))}` };
  }
  return { verdict: 'allowed' };
}

// ── The cache ─────────────────────────────────────────────────────────────

/**
 * @param {{
 *   readTabs: () => unknown,
 *   readHeaders?: (url: string) => Promise<FrameHeaders>,
 *   now?: () => number,
 *   allowRead?: () => boolean,
 * }} deps readTabs: the saved display config's `tabs`; allowRead: the outbound
 *   rate limit, asked before each read the cache can't answer
 */
export function createEmbedChecker({
  readTabs,
  readHeaders = (url) => readFrameHeaders(url),
  now = Date.now,
  allowRead = ((limit) => () => limit('all'))(createRateLimiter({ max: READS_PER_MINUTE, windowMs: 60_000 })),
}) {
  /** @type {Map<string, { url: string, at: number, promise: Promise<FrameHeaders>, result?: FrameHeaders }>} */
  const cache = new Map();

  /** @param {string} tabId */
  function findApp(tabId) {
    const tabs = readTabs();
    if (!Array.isArray(tabs)) return null;
    const tab = tabs.find(
      (t) => t && typeof t === 'object' && String(t.id) === tabId && t.type === 'iframe' && typeof t.url === 'string'
    );
    return tab ? { url: /** @type {string} */ (tab.url) } : null;
  }

  /**
   * The headers `url` answers with, from the cache under `key` or a read.
   * @param {string} key
   * @param {string} url
   * @param {boolean} fresh
   * @returns {Promise<FrameHeaders>}
   */
  async function headersOf(key, url, fresh) {
    const t = now();
    let entry = cache.get(key);
    if (entry && entry.url === url) {
      const ttl = !entry.result ? Infinity : fresh ? FRESH_MIN_AGE_MS : entry.result.ok ? OK_TTL_MS : FAIL_TTL_MS;
      if (t - entry.at < ttl) return entry.promise;
    }
    // Over the limit: say so, and cache nothing, so the next check reads.
    if (!allowRead()) return { ok: false, reason: 'too many checks' };
    const promise = readHeaders(url).catch(() => /** @type {FrameHeaders} */ ({ ok: false, reason: 'unreachable' }));
    entry = { url, at: t, promise };
    cache.delete(key);
    if (cache.size >= MAX_ENTRIES) cache.delete(/** @type {string} */ (cache.keys().next().value));
    cache.set(key, entry);
    const result = await promise;
    entry.result = result;
    return result;
  }

  return {
    /**
     * The headers of the saved app tab `tabId`, or null when the saved config
     * has no app tab with that id.
     * @param {string} tabId
     * @param {{ fresh?: boolean }} [opts]
     * @returns {Promise<{ url: string, result: FrameHeaders } | null>}
     */
    async check(tabId, { fresh = false } = {}) {
      const app = findApp(tabId);
      if (!app) return null;
      return { url: app.url, result: await headersOf(tabId, app.url, fresh) };
    },

    /**
     * The headers of an address that is not saved yet (#362: the add form
     * checks it before it is saved). The same read, rules, cache and limit as
     * a saved tab's; the cache key cannot be a tab id.
     * @param {string} url
     * @param {{ fresh?: boolean }} [opts]
     * @returns {Promise<{ url: string, result: FrameHeaders }>}
     */
    async checkUrl(url, { fresh = false } = {}) {
      return { url, result: await headersOf(`\0url:${url}`, url, fresh) };
    },
  };
}
