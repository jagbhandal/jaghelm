// @ts-check
/**
 * SSRF guard — vetting for outbound URLs, called at the fetch chokepoints
 * (server/integrations/lib/http.js and server/httpClient.js), which cover all
 * integration, session-auth, and infra-proxy requests. A few internal calls
 * still use raw fetch to hardcoded/operator-configured endpoints (Prometheus
 * discovery, Kuma monitors, the icon cache, which fetches only URLs it
 * rebuilds from its own allowlist, server/icon-sources.js, and the app-tab
 * embed check, server/embedCheck.js, which calls assertSafeUrl on every hop
 * itself because it follows no redirect to another host); folding those into
 * one shared client is a tracked follow-up (see docs/IMPROVEMENT-PLAN.md).
 *
 * JagHelm is a homelab dashboard, so private/loopback hosts ARE legitimate
 * integration targets (192.168/16 Proxmox, 10/8 NAS, localhost services). By
 * default we only block things with no legitimate use case:
 *   - non-http(s) schemes (file:, gopher:, ftp:, data:, …)
 *   - the cloud-instance metadata endpoint 169.254.169.254
 *   - 0.0.0.0/8 "this network"
 * An IPv6 literal carrying an IPv4 address ([::ffff:169.254.169.254], which
 * Node connects to over IPv4) is checked as that IPv4 address.
 *
 * Strict mode (set JAGHELM_BLOCK_PRIVATE_NETWORKS=true) additionally blocks all
 * RFC1918 + loopback + link-local + ULA — for multi-tenant deployments that
 * accept integration URLs from untrusted users.
 *
 * `trusted: true` callers (operator-configured infra: Prometheus, Kuma) are
 * exempt from the strict-mode private block — those endpoints are
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

/** @param {string} ip */
function isPrivateV4(ip) {
  return PRIVATE_V4_RANGES.some((re) => re.test(ip));
}

/** @param {string} ip */
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

/**
 * The eight 16-bit pieces of an IPv6 literal (no brackets), or null when it
 * isn't one. Accepts a trailing dotted quad; the URL parser emits hex pieces.
 * @param {string} host
 * @returns {number[] | null}
 */
function v6Pieces(host) {
  if (!host.includes(':')) return null;
  let h = host;
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(2).map(Number);
    if ([a, b, c, d].some((x) => x > 255)) return null;
    h = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = h.split('::');
  if (halves.length > 2) return null;
  /** @param {string} part */
  const parse = (part) =>
    part === '' ? [] : part.split(':').map((x) => (/^[0-9a-f]{1,4}$/i.test(x) ? parseInt(x, 16) : NaN));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some(Number.isNaN)) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  return fill < 1 ? null : [...head, ...new Array(fill).fill(0), ...tail];
}

/**
 * The IPv4 address an IPv6 literal carries, or null. IPv4-mapped
 * (::ffff:a.b.c.d) is what matters: Node connects to it over IPv4, so
 * [::ffff:169.254.169.254] reaches the metadata address. IPv4-compatible
 * (::a.b.c.d, deprecated) and IPv4-translated (::ffff:0:a.b.c.d) are treated
 * the same way, to be safe. :: and ::1 are not IPv4 addresses.
 * @param {string} host
 * @returns {string | null}
 */
function embeddedV4(host) {
  const p = v6Pieces(host);
  if (!p) return null;
  /** @param {number} n */
  const zeros = (n) => p.slice(0, n).every((x) => x === 0);
  const mapped = zeros(5) && p[5] === 0xffff;
  const translated = zeros(4) && p[4] === 0xffff && p[5] === 0;
  const compatible = zeros(6) && !(p[6] === 0 && p[7] <= 1);
  if (!mapped && !translated && !compatible) return null;
  return `${p[6] >> 8}.${p[6] & 0xff}.${p[7] >> 8}.${p[7] & 0xff}`;
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
  // An IPv6 literal that carries an IPv4 address is checked as that address,
  // so every rule below sees [::ffff:a9fe:a9fe] as 169.254.169.254. Messages
  // still name the address as written.
  const v4 = embeddedV4(host);
  const shown = v4 ? `${host} (${v4})` : host;
  if (v4) host = v4;
  const isIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  // The IPv6 unspecified address (::) and its v4-mapped-zero forms target
  // localhost on Linux, so they're the 0.0.0.0 equivalent and must always block.
  // (The WHATWG URL parser normalizes [::]/[0:0:..:0] to "::" and
  // [::ffff:0.0.0.0] to "::ffff:0:0", so match the normalized forms.)
  const isV6Zero =
    host === '::' ||
    /^0:0:0:0:0:0:0:0$/.test(host) ||
    /^::ffff:0{1,4}:0{1,4}$/.test(host) ||
    /^::ffff:0+(\.0){3}$/.test(host);
  // Always block cloud-metadata IP and 0/8 "this network" (no legitimate use).
  if (host === '169.254.169.254' || (isIPv4 && /^0\./.test(host)) || isV6Zero) {
    throw new Error(`Blocked host: ${shown}`);
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
    if (isPrivateV4(host)) throw new Error(`Blocked private ${v4 ? 'IPv6' : 'IPv4'} host: ${shown}`);
    return;
  }
  if (host.includes(':')) {
    if (isPrivateV6(host)) throw new Error(`Blocked private IPv6 host: ${host}`);
    return;
  }
  // Bare hostname — left to DNS at fetch time (see residual-risk note above).
}
