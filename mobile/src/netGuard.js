/**
 * Tailnet cleartext policy. Android's network-security-config cannot express a
 * CIDR range (its <domain> entries are literal hosts only), so the app enables
 * the cleartext *capability* in the manifest and enforces the real scoping HERE:
 * plain http is allowed only to private / tailnet destinations; everything public
 * must be https. This is where CIDR math is actually possible.
 *
 * Path A reaches the JagHelm backend directly over the tailnet, so the realistic
 * backend hosts are: a CGNAT tailnet IP (100.64.0.0/10), a MagicDNS name
 * (*.ts.net) or short single-label name (vm-101), an RFC1918 LAN IP, or loopback.
 */

/** True when `host` is a private / tailnet / loopback destination (cleartext-safe). */
export function isPrivateCleartextHost(host) {
  if (!host) return false;
  let h = String(host).trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1); // strip IPv6 brackets

  if (h === 'localhost') return true;

  // IPv6
  if (h.includes(':')) {
    if (h === '::1') return true; // loopback
    // Unique-local addresses (fc00::/7) incl. Tailscale's fd7a:115c:a1e0::/48.
    if (h.startsWith('fc') || h.startsWith('fd')) return true;
    return false;
  }

  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT/tailnet 100.64.0.0/10
    return false;
  }

  // Hostname
  if (h.endsWith('.ts.net')) return true; // Tailscale MagicDNS
  if (!h.includes('.')) return true; // single-label LAN / MagicDNS short name
  return false;
}

/**
 * Throw unless `rawUrl` is a safe backend URL. https is always allowed; http is
 * allowed only to a private/tailnet host. Throws Error('invalid-url') on
 * unparseable / non-http(s) input, Error('cleartext-public') on http to a public
 * host. Returns undefined when safe.
 */
export function assertSafeBackendUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl).trim());
  } catch {
    throw new Error('invalid-url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('invalid-url');
  if (u.protocol === 'https:') return;
  if (!isPrivateCleartextHost(u.hostname)) throw new Error('cleartext-public');
}
