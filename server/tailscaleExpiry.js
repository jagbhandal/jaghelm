/**
 * Tailscale node keys for the expiry tracker (#676): when each device's key
 * expires, read from the Tailscale API.
 *
 * Set up only when JAGHELM_TAILSCALE_API_KEY is set (an API access token with
 * read access to devices; JAGHELM_TAILNET names the tailnet, "-" when unset,
 * which is the token's own). Unset, and this source is simply absent. The key
 * goes in the Authorization header only; no log line, error text or answer
 * carries it.
 *
 * The request is a GET to one fixed address on api.tailscale.com (the tailnet
 * name is checked and escaped into the path, the host is not configurable),
 * 10 seconds, no redirect followed (a 3xx is a failure, so the key is never
 * sent anywhere the code did not name). One answer is kept 6 hours and shared
 * by every reader. A failed read is asked again after FAILURE_TTL_MS (a
 * rejected key after REJECTED_TTL_MS), one warning per window, and the last
 * good list is served, marked `stale`, for STALE_MAX_MS meanwhile; a rejected
 * key (401/403) drops it, since the list can no longer be vouched for.
 *
 * What is read of each device (the response is parsed defensively; a field
 * that is missing or the wrong shape is "unknown", never a date and never
 * green): `hostname` (else the first part of `name`), `keyExpiryDisabled`, and
 * `expires`. A device with `keyExpiryDisabled: true` is "no expiry" and is
 * only counted. Any other device without a usable `expires` is listed as
 * unknown.
 */
import { envValue } from './env.js';
import { createLogger } from './util/logger.js';
import { redactSecrets } from './util/redact.js';
import { tidyName } from './tlsExpiry.js';

const log = createLogger('expiry');

export const API_ORIGIN = 'https://api.tailscale.com';
export const CACHE_TTL_MS = 6 * 60 * 60_000;
export const FAILURE_TTL_MS = 10 * 60_000;
export const REJECTED_TTL_MS = 30 * 60_000;
export const STALE_MAX_MS = 48 * 60 * 60_000;
export const TIMEOUT_MS = 10_000;
/** Devices read from one answer; a tailnet has a handful, this is a bound. */
export const MAX_DEVICES = 500;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const NAMES_SHOWN = 8;

const TAILNET = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,99}$/;

/**
 * The devices of an API answer, as `{ keyed: [{ id, name, expires }], noExpiry:
 * { count, names } }` (`expires` an ISO time or null: unknown), or null when
 * the body is not a device list.
 *
 * @param {unknown} body
 */
export function parseDevices(body) {
  const list = body && typeof body === 'object' ? /** @type {any} */ (body).devices : null;
  if (!Array.isArray(list)) return null;
  const keyed = [];
  const noExpiry = { count: 0, names: [] };
  list.slice(0, MAX_DEVICES).forEach((d, i) => {
    if (!d || typeof d !== 'object') return;
    const full = typeof d.name === 'string' ? d.name.split('.')[0] : null;
    const name = tidyName(d.hostname) ?? tidyName(full) ?? 'unnamed device';
    if (d.keyExpiryDisabled === true) {
      noExpiry.count += 1;
      if (noExpiry.names.length < NAMES_SHOWN) noExpiry.names.push(name);
      return;
    }
    // Tailscale writes the zero time for "no expiry"; with expiry not stated
    // off, it is not an end date.
    const at = typeof d.expires === 'string' ? Date.parse(d.expires) : NaN;
    const usable = Number.isFinite(at) && new Date(at).getUTCFullYear() > 1971;
    keyed.push({
      id: String(d.nodeId ?? d.id ?? `${name}-${i}`),
      name,
      expires: usable ? new Date(at).toISOString() : null,
    });
  });
  return { keyed, noExpiry };
}

let lastGood = null;
let inFlight = null;
let cached = null; // { body, until }

/** Forget what was read (tests). */
export function _resetTailscale() {
  lastGood = null;
  inFlight = null;
  cached = null;
}

/** The log text for an error, with the key taken out of it. */
function errorText(err, key) {
  const raw = String(err?.message || err);
  const clean = redactSecrets(key ? raw.split(key).join('[redacted]') : raw);
  return clean.length > 160 ? `${clean.slice(0, 160)}…` : clean;
}

async function readDevices(key, tailnet, now, fetchImpl) {
  let reason;
  let state = 'unreachable';
  try {
    const res = await fetchImpl(
      `${API_ORIGIN}/api/v2/tailnet/${encodeURIComponent(tailnet)}/devices`,
      {
        method: 'GET',
        redirect: 'manual',
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );
    if (res.status === 401 || res.status === 403) {
      state = 'rejected';
      reason = `status ${res.status}`;
    } else if (!res.ok) {
      reason = `status ${res.status}`;
    } else if (Number(res.headers?.get?.('content-length')) > MAX_BODY_BYTES) {
      reason = 'answer too large';
    } else {
      let parsed = null;
      try {
        const text = await res.text();
        parsed = text.length > MAX_BODY_BYTES ? null : parseDevices(JSON.parse(text));
      } catch {
        parsed = null;
      }
      if (parsed) {
        const body = { state: 'ok', ...parsed, readAt: now };
        lastGood = body;
        return { body, ttlMs: CACHE_TTL_MS };
      }
      state = 'unreadable';
      reason = 'answer is not a device list';
    }
  } catch (err) {
    reason = errorText(err, key);
  }
  log.warn({ source: 'tailscale', state, reason }, 'Tailscale node keys not read');
  if (state === 'rejected') {
    lastGood = null;
    return { body: { state, keyed: [], noExpiry: { count: 0, names: [] } }, ttlMs: REJECTED_TTL_MS };
  }
  if (lastGood && now - lastGood.readAt < STALE_MAX_MS) {
    return { body: { ...lastGood, state: 'ok', stale: true }, ttlMs: FAILURE_TTL_MS };
  }
  return { body: { state, keyed: [], noExpiry: { count: 0, names: [] } }, ttlMs: FAILURE_TTL_MS };
}

/**
 * The devices' keys: `null` when no key is set (the source is absent), else
 * `{ state: 'ok' | 'rejected' | 'unreachable' | 'unreadable', keyed, noExpiry,
 * stale? }`. Never throws, never carries the key.
 *
 * @param {number} [now]
 * @param {typeof fetch} [fetchImpl]  replaced only by tests
 */
export async function tailscaleAnswer(now = Date.now(), fetchImpl = fetch) {
  const key = envValue('JAGHELM_TAILSCALE_API_KEY');
  if (!key) return null;
  if (cached && now < cached.until) return cached.body;
  if (!inFlight) {
    const tailnetValue = envValue('JAGHELM_TAILNET');
    const tailnet = tailnetValue && TAILNET.test(tailnetValue) ? tailnetValue : '-';
    if (tailnetValue && tailnet === '-') {
      log.warn('JAGHELM_TAILNET is not a tailnet name; using "-" (the key\'s own tailnet)');
    }
    inFlight = readDevices(key, tailnet, now, fetchImpl)
      .then(({ body, ttlMs }) => {
        cached = { body, until: now + ttlMs };
        return body;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
