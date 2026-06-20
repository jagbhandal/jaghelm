/**
 * HTTP client helper.
 *
 * Wraps the global fetch with a default 8-second timeout via AbortSignal.
 * Used by every outbound request from JagHelm (Prometheus, Kuma, AdGuard,
 * NPM, Gitea, integration handlers).
 */

import { fetchSafe } from './util/safeFetchCore.js';

const DEFAULT_TIMEOUT_MS = 8000;

export async function safeFetch(url, opts = {}) {
  const { trusted, timeoutMs, ...fetchOpts } = opts;
  // SSRF guard runs per-hop inside fetchSafe (re-validated across redirects) + a
  // body-size cap. Infra callers (Prometheus, Kuma, AdGuard, NPM, Gitea) are
  // operator-configured and trusted by default, so strict mode can't break them;
  // pass { trusted: false } for any user-influenced URL.
  return fetchSafe(
    url,
    { ...fetchOpts, signal: AbortSignal.timeout(timeoutMs || DEFAULT_TIMEOUT_MS) },
    { trusted: trusted !== false }
  );
}
