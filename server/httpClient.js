/**
 * HTTP client helper.
 *
 * Wraps the global fetch with a default 8-second timeout via AbortSignal.
 * Used by every outbound request from JagHelm (Prometheus, Kuma, AdGuard,
 * NPM, Gitea, integration handlers).
 */

const DEFAULT_TIMEOUT_MS = 8000;

export async function safeFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    signal: AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS),
  });
}
