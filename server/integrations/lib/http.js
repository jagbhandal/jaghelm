import { Agent } from 'undici';
import { assertSafeUrl } from '../../util/ssrf.js';

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
 */

const tlsSkipAgent = new Agent({ connect: { rejectUnauthorized: false } });

const FETCH_TIMEOUT_MS = 8000;

export async function safeFetch(url, opts = {}, skipTls = false) {
  // SSRF chokepoint: every integration AND session-auth request flows through
  // here, so the guard runs by construction — no call site can forget it.
  // trusted=false: these are user-supplied integration URLs (full guard,
  // respects JAGHELM_BLOCK_PRIVATE_NETWORKS).
  assertSafeUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const fetchOpts = { ...opts, signal: controller.signal };
    if (skipTls) fetchOpts.dispatcher = tlsSkipAgent;
    return await fetch(url, fetchOpts);
  } finally {
    clearTimeout(timeout);
  }
}
