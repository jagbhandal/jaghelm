import { Agent } from 'undici';
import { fetchSafe, leftOrigin } from '../../util/safeFetchCore.js';
import { redactSecrets } from '../../util/redact.js';

/**
 * Safe fetch wrapper with timeout + optional per-request TLS skip.
 *
 * TLS skip uses a dedicated undici Agent with rejectUnauthorized=false, scoped
 * to the single request via the `dispatcher` option. This replaces the previous
 * implementation which toggled the process-global NODE_TLS_REJECT_UNAUTHORIZED
 * env var around the await — that approach had a race window where a concurrent
 * non-skipTls fetch (e.g. Cloudflare) could see the flag set to '0' and silently
 * bypass cert validation.
 *
 * The Agent is module-level: instantiated once, shared across all skipTls calls.
 * Non-skipTls fetches use Node's default global dispatcher and validate certs
 * normally — they are completely unaffected by skipTls calls in flight.
 *
 * Currently `tlsSkip: true` is set only by the Proxmox preset, but the per-request
 * dispatcher pattern means any number of presets can use TLS skip safely.
 *
 * The Agent comes from the undici package but is driven by Node's built-in fetch,
 * which is the undici bundled with Node (process.versions.undici). An Agent from
 * another major fails every request with "fetch failed", so bump the undici
 * dependency together with Node (#375; http.test.js checks the majors match).
 */

const tlsSkipAgent = new Agent({ connect: { rejectUnauthorized: false } });

const FETCH_TIMEOUT_MS = 8000;

/**
 * An error's text with the request URL, which carries a credential, replaced
 * by `shownUrl`: the same URL with each credential put back as its placeholder
 * (`/api/{token}/status`). It replaces the URL as it was passed (the form
 * assertSafeUrl and fetch quote, also when it doesn't parse) and any URL on
 * the same host with a path, query or fragment (the parsed form, a
 * same-origin redirect hop). Origins alone, as a refused redirect names them,
 * stay. Without a shownUrl, everything after the origin is withheld.
 * @param {string} text
 * @param {string} url
 * @param {string | undefined} shownUrl
 */
export function hideUrlCredential(text, url, shownUrl) {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    // Unparseable: only the string as passed can be in the message.
  }
  const shown = shownUrl || (parsed ? `${parsed.origin}/[redacted]` : '[a URL that carries a credential]');
  let out = text.split(url).join(shown);
  if (parsed) {
    const host = parsed.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`https?://${host}(?=[/?#])[^\\s'"]*`, 'gi'), () => shown);
  }
  return out;
}

/**
 * @param {string} url
 * @param {RequestInit} [opts]
 * @param {boolean} [skipTls]
 * @param {{ credentialInUrl?: boolean, shownUrl?: string }} [cfg]
 *   credentialInUrl: the URL carries the integration's credential (query-param
 *   auth, or a credential placeholder in the endpoint), so a redirect to
 *   another origin is refused. Set it from the same code that put the
 *   credential in the URL. shownUrl: the URL as an error may show it, with the
 *   credential as its placeholder (resolveEndpoint's shownPath); an error that
 *   quotes the URL quotes this instead (#425).
 */
export async function safeFetch(url, opts = {}, skipTls = false, { credentialInUrl = false, shownUrl } = {}) {
  try {
    // SSRF guard runs per-hop inside fetchSafe (trusted=false: user-supplied URLs,
    // full guard, re-validated across redirects) + a response-body size cap.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetchSafe(url, { ...opts, signal: controller.signal },
        { trusted: false, dispatcher: skipTls ? tlsSkipAgent : undefined, credentialInUrl });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    // Redact at the egress point: query-auth presets put the API key in the URL
    // and fetch/assertSafeUrl errors echo it. Stripping it here means no
    // downstream catch (handler, session) can leak it even if it forgets to.
    // A credential in the path ({token} in the endpoint) is one redaction can't
    // find, so a URL carrying one is swapped for shownUrl first.
    const text = (err && err.message) || String(err);
    const safe = new Error(redactSecrets(credentialInUrl ? hideUrlCredential(text, url, shownUrl) : text));
    // What the status model reads the cause from (failureWords.js, #605): the
    // code undici keeps on its cause ("fetch failed", ECONNREFUSED as the
    // cause's), and this timeout's abort as a timeout.
    const code = err?.code ?? err?.cause?.code ?? err?.cause?.errors?.[0]?.code;
    if (typeof code === 'string' && code) safe.code = code;
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') safe.failure = 'timeout';
    throw safe;
  }
}

/**
 * Whether a response from safeFetch refused the credentials the request sent: a
 * 401 or 403 from the request's own origin. After a redirect to another origin
 * the request no longer carried them (fetchSafe drops credential headers and
 * bodies there), so a 401 or 403 from that host is a plain failure. The refresh
 * loop stops repeating a login refused this way until the integration's config
 * changes (#239).
 * @param {Response} res
 */
export function isAuthRejection(res) {
  return (res.status === 401 || res.status === 403) && !leftOrigin(res);
}

// A media type as a Content-Type header names it (`text/html`), for an error.
const MEDIA_TYPE = /^[\w.+-]{1,40}\/[\w.+-]{1,60}$/;

/**
 * The parsed JSON body of an upstream answer. One that is not JSON throws
 * "The reply is not JSON", with its media type when the answer names one: never
 * a word of the body, which the parser's own error quotes ("Unexpected token
 * '<', "<!DOCTYPE "...") and which would reach the card, the connection test
 * and the log.
 * @param {Response} res
 */
export async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const type = String(res.headers?.get?.('content-type') || '').split(';')[0].trim();
    throw new Error(`The reply is not JSON${MEDIA_TYPE.test(type) ? ` (${type})` : ''}`);
  }
}
