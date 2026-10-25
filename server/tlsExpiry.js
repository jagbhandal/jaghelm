/**
 * One TLS certificate read for the expiry tracker (#676): a real handshake with
 * the target, and the leaf certificate's end date and issuer taken from it.
 *
 * The handshake is made with `rejectUnauthorized: false` on purpose: an expired
 * or self-signed certificate must still be READ and reported, which a verifying
 * connection refuses to do. Nothing is trusted because of it: the socket is
 * closed the moment the certificate is in, nothing is sent over it, and the
 * answer is the dates alone. No HTTP request is made, so there is no redirect
 * to follow and nothing is sent beyond the handshake (SNI carries the name that
 * was typed).
 *
 * The target is checked like the other outbound requests are: the SSRF guard
 * (util/ssrf.js) refuses the cloud metadata address and "this network" always,
 * and with JAGHELM_BLOCK_PRIVATE_NETWORKS=true also private, loopback and
 * link-local addresses. A name is looked up here, not by the socket, so the
 * address the guard sees is the one connected to (no rebinding between the
 * check and the connect).
 *
 * States: `ok` (a certificate with an end date; days left are worked out when
 * the answer is built), `expired`, `unreachable` (no TCP connection: refused,
 * timed out, no such name), `handshake_failed` (connected, but no certificate:
 * not a TLS port, a protocol error, a stalled handshake), `blocked` (refused by
 * the network setting). `mismatch` is true when the certificate does not cover
 * the typed name or address (subject CN or SAN, IP SAN for an address). Never throws.
 */
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import { assertSafeUrl } from './util/ssrf.js';
import { parseTarget } from './expiryTargets.js';

export const PROBE_TIMEOUT_MS = 6_000;

const urlHost = (host) => (net.isIPv6(host) ? `[${host}]` : host);

/** A certificate name as one short line: no control characters, cut to 60. */
export function tidyName(value) {
  const one = Array.isArray(value) ? value[0] : value;
  if (typeof one !== 'string') return null;
  const clean = one.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > 60 ? `${clean.slice(0, 59).trimEnd()}…` : clean;
}

/** The short code of a socket error (ECONNREFUSED, …) when it is one, else null. */
function codeOf(err) {
  const code = err && typeof err === 'object' ? err.code : null;
  return typeof code === 'string' && /^[A-Z0-9_]{3,40}$/.test(code) ? code : null;
}

/**
 * Read the certificate `key` (a canonical target, see parseTarget) serves.
 *
 * @param {string} key
 * @param {{ now?: number, timeoutMs?: number, connect?: typeof tls.connect,
 *   lookup?: (host: string) => Promise<string> }} [deps]  replaced only by tests
 * @returns {Promise<{ state: 'ok' | 'expired' | 'unreachable' | 'handshake_failed' | 'blocked',
 *   notAfter: string | null, issuer: string | null, code: string | null, checkedAt: number }>}
 */
export async function probeTls(key, deps = {}) {
  const now = deps.now ?? Date.now();
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  const connect = deps.connect ?? tls.connect;
  const lookup =
    deps.lookup ??
    (async (host) => (await dns.promises.lookup(host)).address);
  const out = (state, extra = {}) => ({
    state,
    notAfter: null,
    issuer: null,
    code: null,
    mismatch: false,
    checkedAt: now,
    ...extra,
  });

  const target = parseTarget(key);
  if (!target) return out('blocked', { code: 'BAD_TARGET' });
  const { host, port } = target;

  let address = host;
  try {
    assertSafeUrl(`https://${urlHost(host)}:${port}/`, { trusted: false });
    if (net.isIP(host) === 0) {
      try {
        address = await lookup(host);
      } catch (err) {
        return out('unreachable', { code: codeOf(err) ?? 'ENOTFOUND' });
      }
      assertSafeUrl(`https://${urlHost(address)}:${port}/`, { trusted: false });
    }
  } catch {
    return out('blocked');
  }

  return new Promise((resolve) => {
    let connected = false;
    let done = false;
    let socket;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        /* already closed */
      }
      resolve(result);
    };
    const failed = (err) =>
      finish(out(connected ? 'handshake_failed' : 'unreachable', { code: codeOf(err) }));
    const timer = setTimeout(() => failed({ code: 'ETIMEDOUT' }), timeoutMs);
    timer.unref?.();
    try {
      socket = connect({
        host: address,
        port,
        // An IP address is no server name; SNI carries what was typed otherwise.
        servername: net.isIP(host) === 0 ? host : undefined,
        rejectUnauthorized: false,
      });
    } catch (err) {
      failed(err);
      return;
    }
    socket.once('connect', () => {
      connected = true;
    });
    // `on`: a second error after the first must not be unhandled (the socket is destroyed by finish).
    socket.on('error', failed);
    socket.once('secureConnect', () => {
      try {
        const cert = socket.getPeerCertificate();
        const end = cert && typeof cert.valid_to === 'string' ? Date.parse(cert.valid_to) : NaN;
        if (!Number.isFinite(end)) {
          finish(out('handshake_failed', { code: 'NO_CERT' }));
          return;
        }
        const issuer = tidyName(cert.issuer?.CN) ?? tidyName(cert.issuer?.O);
        // Does the certificate cover the name (or IP) that was typed? A proxy's
        // default certificate for another name must not read as fine.
        const mismatch = tls.checkServerIdentity(host, cert) !== undefined;
        finish(
          out(end < now ? 'expired' : 'ok', {
            notAfter: new Date(end).toISOString(),
            issuer,
            mismatch,
          })
        );
      } catch (err) {
        failed(err);
      }
    });
  });
}
