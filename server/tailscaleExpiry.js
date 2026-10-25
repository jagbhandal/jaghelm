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
import { keyedSecretName } from './integrations/lib/config.js';
import { resolveCredential } from './secrets.js';
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

/** An expired key on a device not seen for this long is "offline", not an alarm. */
export const OFFLINE_AFTER_MS = 30 * 24 * 60 * 60_000;
const OFFLINE_SHOWN = 5;

/** The usable time of an ISO string, or null (Tailscale writes the zero time for "never"). */
function timeOf(value) {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) && new Date(at).getUTCFullYear() > 1971 ? at : null;
}

/**
 * The devices of an API answer, as `{ keyed: [{ id, name, expires }], noExpiry:
 * { count, names }, offline: [{ name, lastSeen }] }` (`expires` an ISO time or
 * null: unknown), or null when the body is not a device list.
 *
 * The name is the first part of `name` (the machine name in the admin console),
 * else `hostname` (a phone can report "localhost" there); two devices with the
 * same name get their short id after it. Devices shared in from another tailnet
 * (`isExternal`) are not this tailnet's keys and are skipped. A device whose key
 * has expired and that was last seen over OFFLINE_AFTER_MS ago is `offline`, apart
 * from `keyed`, so a forgotten device does not read as an alarm.
 *
 * @param {unknown} body
 * @param {number} [now]
 */
export function parseDevices(body, now = Date.now()) {
  const list = body && typeof body === 'object' ? /** @type {any} */ (body).devices : null;
  if (!Array.isArray(list)) return null;
  const rows = [];
  list.slice(0, MAX_DEVICES).forEach((d, i) => {
    if (!d || typeof d !== 'object' || d.isExternal === true) return;
    const full = typeof d.name === 'string' ? d.name.split('.')[0] : null;
    rows.push({
      d,
      i,
      name: tidyName(full) ?? tidyName(d.hostname) ?? 'unnamed device',
      id: String(d.nodeId ?? d.id ?? `${i}`),
    });
  });
  const counts = new Map();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  const keyed = [];
  const offline = [];
  const noExpiry = { count: 0, names: [] };
  for (const { d, name: base, id } of rows) {
    const name = counts.get(base) > 1 ? `${base} (${id.replace(/^n/, '').slice(0, 6)})` : base;
    if (d.keyExpiryDisabled === true) {
      noExpiry.count += 1;
      if (noExpiry.names.length < NAMES_SHOWN) noExpiry.names.push(name);
      continue;
    }
    // With expiry not stated off, a zero time is not an end date.
    const at = timeOf(d.expires);
    const seen = timeOf(d.lastSeen);
    if (at !== null && at < now && seen !== null && now - seen > OFFLINE_AFTER_MS) {
      if (offline.length < OFFLINE_SHOWN) offline.push({ name, lastSeen: new Date(seen).toISOString() });
      continue;
    }
    keyed.push({ id, name, expires: at === null ? null : new Date(at).toISOString() });
  }
  return { keyed, noExpiry, offline };
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
        parsed = text.length > MAX_BODY_BYTES ? null : parseDevices(JSON.parse(text), now);
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
    return { body: { state, keyed: [], noExpiry: { count: 0, names: [] }, offline: [] }, ttlMs: REJECTED_TTL_MS };
  }
  if (lastGood && now - lastGood.readAt < STALE_MAX_MS) {
    return { body: { ...lastGood, state: 'ok', stale: true }, ttlMs: FAILURE_TTL_MS };
  }
  return { body: { state, keyed: [], noExpiry: { count: 0, names: [] }, offline: [] }, ttlMs: FAILURE_TTL_MS };
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
  // The Tailscale integration's key: .env (the REPLACE_ME template counts as unset),
  // else the secret Settings stored for it.
  const key = resolveCredential('JAGHELM_TAILSCALE_API_KEY', keyedSecretName('tailscale', 'token'));
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
