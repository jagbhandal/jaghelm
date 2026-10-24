/**
 * What the expiry tracker (#676) tracks and when it turns amber and red: the
 * TLS targets Settings keeps (`expiry.tls`) and the two lines in days
 * (`expiryWarnDays`, `expiryCritDays`). Kept apart from configSchema.js (which
 * needs zod) and free of Node imports, so the web reads it too: the same
 * parser decides what Settings accepts and what the server connects to.
 */

/** Targets the list takes; a longer saved list is cut to this many. */
export const MAX_TLS_TARGETS = 30;
export const EXPIRY_DEFAULT = Object.freeze({ warn: 21, crit: 7 });
export const EXPIRY_LIMITS = Object.freeze({ min: 1, max: 365 });

const LABEL = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^\[([0-9a-f:.]{2,45})\]$/;

/**
 * One typed target, `host` or `host:port` (a name, an IPv4 address, or an IPv6
 * address in brackets; port 443 when none), as `{ host, port, key }`, or null
 * for anything else: a scheme, path, user name, space, empty label or a port
 * outside 1-65535. `key` is the canonical text (lower case, ":443" left off)
 * that is saved and shown; `host` has no brackets.
 *
 * @param {unknown} text
 * @returns {{ host: string, port: number, key: string } | null}
 */
export function parseTarget(text) {
  if (typeof text !== 'string') return null;
  const raw = text.trim().toLowerCase();
  if (raw === '' || raw.length > 260) return null;
  let host;
  let portText = null;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end === -1) return null;
    host = raw.slice(0, end + 1);
    const rest = raw.slice(end + 1);
    if (rest !== '') {
      if (!rest.startsWith(':')) return null;
      portText = rest.slice(1);
    }
    const m = IPV6.exec(host);
    if (!m || (m[1].match(/:/g) ?? []).length < 2 || m[1].includes(':::')) return null;
  } else {
    const parts = raw.split(':');
    if (parts.length > 2) return null;
    host = parts[0];
    portText = parts[1] ?? null;
    if (host.length > 253 || host.endsWith('.') || host === '') return null;
    const labels = host.split('.');
    const v4 = IPV4.exec(host);
    if (v4) {
      if (v4.slice(1).some((o) => Number(o) > 255)) return null;
    } else if (!labels.every((l) => LABEL.test(l)) || labels.every((l) => /^\d+$/.test(l))) {
      return null;
    }
  }
  let port = 443;
  if (portText !== null) {
    if (!/^\d{1,5}$/.test(portText)) return null;
    port = Number(portText);
    if (port < 1 || port > 65535) return null;
  }
  const bare = host.startsWith('[') ? host.slice(1, -1) : host;
  return { host: bare, port, key: port === 443 ? host : `${host}:${port}` };
}

/**
 * A saved list as a clean one: only the entries that parse, in canonical form,
 * each once, at most MAX_TLS_TARGETS, order kept. Anything else is dropped one
 * entry at a time, so one bad row never costs the list.
 *
 * @param {unknown} list
 * @returns {string[]}
 */
export function cleanTargets(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  for (const item of list) {
    const t = parseTarget(item);
    if (t) seen.add(t.key);
    if (seen.size >= MAX_TLS_TARGETS) break;
  }
  return [...seen];
}

const whole = (v) =>
  Number.isInteger(v) && v >= EXPIRY_LIMITS.min && v <= EXPIRY_LIMITS.max;

/**
 * The lines to draw by, in days left: a saved line that is whole days, 1 to 365
 * (the other one's default when only one is saved), and only as a pair with
 * red under amber; any other pair reads as the defaults.
 *
 * @param {{ expiryWarnDays?: unknown, expiryCritDays?: unknown } | null | undefined} config
 */
export function expiryLines(config) {
  const warn = whole(config?.expiryWarnDays) ? /** @type {number} */ (config?.expiryWarnDays) : EXPIRY_DEFAULT.warn;
  const crit = whole(config?.expiryCritDays) ? /** @type {number} */ (config?.expiryCritDays) : EXPIRY_DEFAULT.crit;
  return crit < warn ? { warn, crit } : { ...EXPIRY_DEFAULT };
}
