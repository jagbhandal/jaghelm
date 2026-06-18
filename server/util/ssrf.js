/**
 * SSRF guard — vetting for outbound URLs, called at the fetch chokepoints
 * (server/integrations/lib/http.js and server/httpClient.js), which cover all
 * integration, session-auth, and infra-proxy requests. A few internal calls
 * still use raw fetch to hardcoded/operator-configured endpoints (Prometheus
 * discovery, Kuma monitors, the icon CDN index); folding those into one shared
 * client is a tracked follow-up (see docs/IMPROVEMENT-PLAN.md).
 *
 * JagHelm is a homelab dashboard, so private/loopback hosts ARE legitimate
 * integration targets (192.168/16 Proxmox, 10/8 NAS, localhost services). By
 * default we only block things with no legitimate use case:
 *   - non-http(s) schemes (file:, gopher:, ftp:, data:, …)
 *   - the cloud-instance metadata endpoint 169.254.169.254
 *   - 0.0.0.0/8 "this network"
 *
 * Strict mode (set JAGHELM_BLOCK_PRIVATE_NETWORKS=true) additionally blocks all
 * RFC1918 + loopback + link-local + ULA — for multi-tenant deployments that
 * accept integration URLs from untrusted users.
 *
 * `trusted: true` callers (operator-configured infra: Prometheus, Kuma, the
 * icon CDN) are exempt from the strict-mode private block — those endpoints are
 * SUPPOSED to be private, so strict mode must not break them — but the baseline
 * scheme/metadata checks still apply.
 *
 * Residual risk: DNS rebinding — a public hostname can resolve to a private IP
 * at fetch time. Pinning the resolved socket isn't cleanly exposed by Node's
 * global fetch; acceptable for homelab use, revisit for untrusted-tenant configs.
 */

const PRIVATE_V4_RANGES = [
  /^127\./, // 127/8 loopback
  /^10\./, // 10/8
  /^192\.168\./, // 192.168/16
  /^169\.254\./, // 169.254/16 link-local
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16/12
];

function isPrivateV4(ip) {
  return PRIVATE_V4_RANGES.some((re) => re.test(ip));
}

function isPrivateV6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  // fc00::/7 unique-local + fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
  // IPv4-mapped IPv6 — dotted-quad ("::ffff:127.0.0.1") and hex-normalized
  // ("::ffff:7f00:1", what WHATWG URL emits).
  const dottedMapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMapped && isPrivateV4(dottedMapped[1])) return true;
  const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    if (isPrivateV4(`${a}.${b}.${c}.${d}`)) return true;
  }
  return false;
}

function strictMode() {
  return String(process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS || '').toLowerCase() === 'true';
}

/**
 * Throw if `rawUrl` is unsafe to fetch. Called at the fetch chokepoint so every
 * outbound request is guarded by construction.
 * @param {string} rawUrl
 * @param {{ trusted?: boolean }} [opts] trusted = operator-configured infra
 */
export function assertSafeUrl(rawUrl, opts = {}) {
  const { trusted = false } = opts;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`);
  }
  // Strip brackets URL parsing leaves on v6 literals ("[::1]" → "::1").
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host === '') {
    throw new Error('Blocked host: (empty)');
  }
  const isIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  // Always block cloud-metadata IP and 0/8 "this network" (no legitimate use).
  if (host === '169.254.169.254' || (isIPv4 && /^0\./.test(host))) {
    throw new Error(`Blocked host: ${host}`);
  }
  // Trusted infra callers are never subject to the private-range block; for
  // everyone else it only engages in strict mode.
  if (trusted || !strictMode()) {
    return;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error(`Blocked host: ${host}`);
  }
  if (isIPv4) {
    if (isPrivateV4(host)) throw new Error(`Blocked private IPv4 host: ${host}`);
    return;
  }
  if (host.includes(':')) {
    if (isPrivateV6(host)) throw new Error(`Blocked private IPv6 host: ${host}`);
    return;
  }
  // Bare hostname — left to DNS at fetch time (see residual-risk note above).
}
