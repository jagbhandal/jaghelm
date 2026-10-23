/**
 * A client address as the login limiter sees it (#257, rateLimit.js).
 *
 * addressKey: the key failures are counted under. An IPv4 address is its own
 * key. An IPv6 address counts per /64, the network one host is given, so a
 * host can't rotate through its 2^64 addresses to dodge its wait; the devices
 * of one IPv6 network then share a wait, as the devices behind one IPv4 NAT
 * do. An IPv4 client on a dual-stack socket (::ffff:a.b.c.d) is keyed as the
 * IPv4 address. Anything that isn't an IP (a spoofed X-Forwarded-For can say
 * anything) shares the key `unknown`, so keys stay short.
 *
 * parseTrustedNets: LOGIN_TRUSTED_NETS, comma-separated CIDRs or single
 * addresses, IPv4 and IPv6. An entry that isn't one, or is /0 (everything),
 * is refused, with one warning naming the refused entries.
 */
import { BlockList, isIP } from 'node:net';

const UNKNOWN = 'unknown';

/** The eight 16-bit groups of a valid IPv6 address (no zone). */
function groups(v6) {
  const parse = (part) => {
    if (!part) return [];
    const out = [];
    for (const g of part.split(':')) {
      if (g.includes('.')) {
        const [a, b, c, d] = g.split('.').map(Number);
        out.push((a << 8) | b, (c << 8) | d);
      } else out.push(parseInt(g, 16));
    }
    return out;
  };
  const [head, tail] = v6.split('::');
  if (tail === undefined) return parse(head);
  const h = parse(head);
  const t = parse(tail);
  return [...h, ...Array(8 - h.length - t.length).fill(0), ...t];
}

/** An IPv4-mapped IPv6 address (::ffff:a.b.c.d) as IPv4, else null. */
function mappedV4(g) {
  if (g.slice(0, 5).some((x) => x !== 0) || g[5] !== 0xffff) return null;
  return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
}

/**
 * The address without an IPv6 zone, its family (4 or 6, IPv4-mapped counted
 * as 4), and its key; null for anything that isn't an IP.
 */
function parse(ip) {
  if (typeof ip !== 'string' || ip.length > 64) return null;
  const family = isIP(ip);
  if (family === 4) return { address: ip, family: 4, key: ip };
  if (family !== 6) return null;
  const address = ip.split('%')[0];
  const g = groups(address);
  const v4 = mappedV4(g);
  if (v4) return { address: v4, family: 4, key: v4 };
  const prefix = g.slice(0, 4).map((x) => x.toString(16)).join(':');
  return { address, family: 6, key: `${prefix}::/64` };
}

/** The limiter's key for a client address. */
export function addressKey(ip) {
  return parse(ip)?.key ?? UNKNOWN;
}

/** Whether `key` is one addressKey makes (and not `unknown`): what the known-addresses file may hold. */
export function isKnownKey(key) {
  if (typeof key !== 'string' || key === UNKNOWN) return false;
  const ip = key.endsWith('::/64') ? key.slice(0, -3) : key;
  return addressKey(ip) === key;
}

/**
 * LOGIN_TRUSTED_NETS as `{ has(ip) }`. `text` is the variable's value; bad
 * entries are refused and named in one warning on `log`.
 */
export function parseTrustedNets(text, log) {
  const list = new BlockList();
  let any = false;
  const refused = [];
  for (const entry of String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [address, prefixText, extra] = entry.split('/');
    const family = extra === undefined ? isIP(address) : 0;
    const bits = family === 4 ? 32 : 128;
    const prefix = prefixText === undefined ? bits : /^\d{1,3}$/.test(prefixText) ? Number(prefixText) : -1;
    try {
      if (!family || prefix < 1 || prefix > bits) throw new Error('not a CIDR');
      list.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6'); // throws on what isIP lets by (a zone)
      any = true;
    } catch {
      refused.push(entry.slice(0, 64));
    }
  }
  if (refused.length > 0) {
    log.warn({ refused }, 'LOGIN_TRUSTED_NETS: refused entries that are not an address or CIDR (or are /0)');
  }
  return {
    has(ip) {
      if (!any) return false;
      const p = parse(ip);
      return !!p && list.check(p.address, p.family === 4 ? 'ipv4' : 'ipv6');
    },
  };
}
