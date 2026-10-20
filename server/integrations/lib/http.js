import { Agent } from 'undici';
import { fetchSafe, leftOrigin } from '../../util/safeFetchCore.js';
import { redactError } from '../../util/redact.js';

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
 * @param {string} url
 * @param {RequestInit} [opts]
 * @param {boolean} [skipTls]
 * @param {{ credentialInUrl?: boolean }} [cfg] credentialInUrl: the URL carries
 *   the integration's credential (query-param auth, or a credential placeholder
 *   in the endpoint), so a redirect to another origin is refused. Set it from
 *   the same code that put the credential in the URL.
 */
export async function safeFetch(url, opts = {}, skipTls = false, { credentialInUrl = false } = {}) {
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
    const safe = new Error(redactError(err));
    if (err && err.code) safe.code = err.code;
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
