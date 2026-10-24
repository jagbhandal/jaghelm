// @ts-check
/**
 * The Web Push subscriptions (#653): one per browser that turned alerts on,
 * kept in a tolerant JSON load that
 * never throws, an atomic write on every change, a factory with an injectable
 * clock, and the same record fields the device list reads (registration,
 * last seen, last delivery, last failed send, the prefs).
 *
 * A subscription is a capability: its endpoint URL is the address anyone can
 * push to, and `p256dh` and `auth` are the keys that encrypt for that browser.
 * So the file is written 0600; the endpoint and keys leave this module through
 * `subscriptionOf` alone, which only the sender calls; every other view (list,
 * getDevices, getAllTokens) carries an id and a name, never the endpoint or a
 * key; and what is stored is checked on the way in and again on load (the
 * endpoint against the allowlist, push/pushEndpoint.js; the keys' sizes and
 * that the point is on the curve), so a hand-edited file cannot aim the sender
 * at another host.
 *
 * A subscription is named by its `id`, the first 12 hex characters of the
 * SHA-256 of its endpoint (the page computes the same from its own
 * subscription, so it can tell which row is this browser's). The outbox knows
 * it as the pseudo token `wp:<id>`, which is no secret and what the logs show.
 *
 * Limits: MAX_SUBSCRIPTIONS records, a name of at most 64 characters, an
 * endpoint of at most MAX_ENDPOINT_LENGTH. Registering the same endpoint again
 * updates it (name, keys, last seen) and is no new record.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { DATA_DIR } from '../util/dataDir.js';
import { createLogger } from '../util/logger.js';
import { checkEndpoint } from './pushEndpoint.js';
import { clonePrefs, DEFAULT_PREFS, normalizePrefs } from './prefs.js';
import { fromBase64url, isUncompressedPoint, publicKeyOf } from './webPushCrypto.js';

const log = createLogger('push-web-store');

const DEFAULT_PATH = join(DATA_DIR, 'push-subscriptions.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** A subscription unseen this long (no registration, no accepted push) is dropped; browsers expire theirs sooner. */
const STALE_AFTER_MS = 180 * DAY_MS;

/** The most subscriptions kept: a homelab has a few phones and browsers. */
export const MAX_SUBSCRIPTIONS = 20;
export const MAX_NAME_LENGTH = 64;
export const DEFAULT_NAME = 'Web browser';

/** The pseudo token the outbox knows a subscription by. */
export const WEB_TOKEN_PREFIX = 'wp:';
/** @param {unknown} token */
export const isWebToken = (token) => typeof token === 'string' && /^wp:[0-9a-f]{12}$/.test(token);

/** A subscription's id: from its endpoint, so a re-registration finds the same record. @param {string} endpoint */
export function subscriptionId(endpoint) {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 12);
}

/** A device name as kept: printable, trimmed, short; the default when nothing is left. @param {unknown} raw */
export function cleanName(raw) {
  // Control characters (and newlines) become spaces, then runs of space one.
  const text =
    typeof raw === 'string'
      ? [...raw].map((c) => (c < ' ' || c === '\u007f' ? ' ' : c)).join('').replace(/\s+/g, ' ').trim()
      : '';
  return text.slice(0, MAX_NAME_LENGTH).trim() || DEFAULT_NAME;
}

/**
 * The keys of a PushSubscription, checked: `p256dh` is a 65 byte point on the
 * curve, `auth` a 16 byte secret, both base64url. Returns the normalized
 * strings, or why not (never the value).
 * @param {unknown} keys
 * @returns {{ ok: true, p256dh: string, auth: string } | { ok: false, reason: string }}
 */
export function checkKeys(keys) {
  const k = /** @type {any} */ (keys);
  if (!k || typeof k !== 'object' || typeof k.p256dh !== 'string' || typeof k.auth !== 'string') {
    return { ok: false, reason: 'The subscription has no keys' };
  }
  if (k.p256dh.length > 128 || k.auth.length > 64) {
    return { ok: false, reason: 'The subscription keys are the wrong size' };
  }
  try {
    const point = fromBase64url(k.p256dh);
    const auth = fromBase64url(k.auth);
    if (!isUncompressedPoint(point) || auth.length !== 16) {
      return { ok: false, reason: 'The subscription keys are the wrong size' };
    }
    publicKeyOf(point); // on the curve
    return { ok: true, p256dh: point.toString('base64url'), auth: auth.toString('base64url') };
  } catch {
    return { ok: false, reason: 'The subscription keys are not valid' };
  }
}

/**
 * @typedef {object} Subscription
 * @property {string} endpoint
 * @property {string} p256dh
 * @property {string} auth
 */

/** @param {{ path?: string, now?: () => number }} [opts] */
export function createWebPushStore({ path = DEFAULT_PATH, now = Date.now } = {}) {
  /** @type {Record<string, any>} */
  let store = load();
  let savedAt = -Infinity;

  /** Tolerant load: a missing or damaged file is an empty store, a damaged record is dropped. */
  function load() {
    /** @type {Record<string, any>} */
    const safe = Object.create(null);
    try {
      if (!existsSync(path)) return safe;
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return safe;
      for (const id of Object.keys(parsed)) {
        const rec = parsed[id];
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
        if (typeof rec.endpoint !== 'string' || !checkEndpoint(rec.endpoint).ok) continue;
        if (id !== subscriptionId(rec.endpoint)) continue;
        if (!checkKeys({ p256dh: rec.p256dh, auth: rec.auth }).ok) continue;
        if (!Number.isFinite(rec.createdAt)) rec.createdAt = now();
        if (!Number.isFinite(rec.lastSeenAt)) rec.lastSeenAt = now();
        rec.name = cleanName(rec.name);
        rec.prefs = normalizePrefs(rec.prefs);
        if (rec.lastDeliveredAt !== undefined && !Number.isFinite(rec.lastDeliveredAt)) delete rec.lastDeliveredAt;
        const err = rec.lastError;
        if (err !== undefined && !(err && Number.isFinite(err.at) && typeof err.code === 'string')) delete rec.lastError;
        safe[id] = rec;
        if (Object.keys(safe).length >= MAX_SUBSCRIPTIONS) break;
      }
    } catch {
      // damaged file: start empty (the error text could quote the file)
      log.warn('The Web Push subscription file could not be read; starting with none');
    }
    return safe;
  }

  function save() {
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      atomicWriteFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 });
      savedAt = now();
    } catch (err) {
      // The error names the path, never a subscription.
      log.error({ code: /** @type {any} */ (err)?.code }, 'Failed to save Web Push subscriptions');
    }
  }

  const has = (/** @type {string} */ id) => Object.hasOwn(store, id);
  const idOfToken = (/** @type {unknown} */ token) => (isWebToken(token) ? String(token).slice(WEB_TOKEN_PREFIX.length) : null);

  /** A record without its endpoint and keys. @param {any} rec */
  function publicView(rec) {
    const { endpoint: _e, p256dh: _p, auth: _a, ...rest } = rec;
    return { ...rest, prefs: clonePrefs(rec.prefs) };
  }

  /** @param {string} id */
  function removeById(id) {
    if (typeof id !== 'string' || !has(id)) return false;
    delete store[id];
    save();
    return true;
  }
  /** @param {string} token */
  function removeToken(token) {
    const id = idOfToken(token);
    return id === null ? false : removeById(id);
  }
  /** @param {string} id */
  function tokenOfDevice(id) {
    return typeof id === 'string' && /^[0-9a-f]{12}$/.test(id) && has(id) ? `${WEB_TOKEN_PREFIX}${id}` : null;
  }

  return {
    /**
     * Add or refresh a subscription. The endpoint and keys must already have
     * passed checkEndpoint and checkKeys (the route does; this checks again).
     * `{ ok: true, id, created }`, or `{ ok: false, reason }` when full.
     * @param {{ endpoint: string, p256dh: string, auth: string, name?: unknown }} sub
     */
    register({ endpoint, p256dh, auth, name }) {
      const e = checkEndpoint(endpoint);
      const k = checkKeys({ p256dh, auth });
      if (!e.ok) return /** @type {const} */ ({ ok: false, reason: e.reason });
      if (!k.ok) return /** @type {const} */ ({ ok: false, reason: k.reason });
      const id = subscriptionId(endpoint);
      const ts = now();
      if (has(id)) {
        const rec = store[id];
        rec.p256dh = k.p256dh;
        rec.auth = k.auth;
        rec.lastSeenAt = ts;
        if (name !== undefined) rec.name = cleanName(name);
        delete rec.lastError;
        save();
        return /** @type {const} */ ({ ok: true, id, created: false, name: rec.name });
      }
      if (Object.keys(store).length >= MAX_SUBSCRIPTIONS) {
        return /** @type {const} */ ({
          ok: false,
          reason: `JagHelm keeps at most ${MAX_SUBSCRIPTIONS} browsers; remove one first`,
        });
      }
      store[id] = {
        name: cleanName(name),
        endpoint,
        p256dh: k.p256dh,
        auth: k.auth,
        createdAt: ts,
        lastSeenAt: ts,
        prefs: clonePrefs(/** @type {any} */ (DEFAULT_PREFS)),
      };
      save();
      return /** @type {const} */ ({ ok: true, id, created: true, name: store[id].name });
    },

    /** What the sender needs for a pseudo token, or null. The only reader of the endpoint and keys. @param {string} token */
    subscriptionOf(token) {
      const id = idOfToken(token);
      if (id === null || !has(id)) return null;
      const { endpoint, p256dh, auth } = store[id];
      return /** @type {Subscription} */ ({ endpoint, p256dh, auth });
    },

    /** The list Settings reads: id, name, when added, when last seen. Never the endpoint or keys. */
    list() {
      return Object.keys(store)
        .map((id) => ({
          id,
          name: store[id].name,
          createdAt: new Date(store[id].createdAt).toISOString(),
          lastSeen: new Date(store[id].lastSeenAt).toISOString(),
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },

    removeById,

    // ── the token-store interface the outbox, the cycle and the test push use ──

    removeToken,

    getAllTokens() {
      return Object.keys(store).map((id) => ({ token: `${WEB_TOKEN_PREFIX}${id}`, ...publicView(store[id]) }));
    },

    /** @param {string} token */
    getPrefs(token) {
      const id = idOfToken(token);
      return id !== null && has(id) ? normalizePrefs(store[id].prefs) : normalizePrefs(undefined);
    },

    /** @param {string} token @param {unknown} prefs */
    setPrefs(token, prefs) {
      const id = idOfToken(token);
      if (id === null || !has(id)) return null;
      store[id].prefs = normalizePrefs(prefs);
      save();
      return publicView(store[id]);
    },

    /** An accepted push: its delivery time, its error cleared, last seen bumped at most daily. @param {string[]} tokens */
    markDelivered(tokens) {
      const ts = now();
      let bumped = 0;
      let delivered = 0;
      let cleared = 0;
      for (const token of tokens) {
        const id = idOfToken(token);
        if (id === null || !has(id)) continue;
        const rec = store[id];
        rec.lastDeliveredAt = ts;
        delivered += 1;
        if (rec.lastError !== undefined) {
          delete rec.lastError;
          cleared += 1;
        }
        if (ts - rec.lastSeenAt < DAY_MS) continue;
        rec.lastSeenAt = ts;
        bumped += 1;
      }
      if (bumped > 0 || cleared > 0 || (delivered > 0 && ts - savedAt >= HOUR_MS)) save();
      return bumped;
    },

    /** A failed send: its code, written when new or at most hourly. @param {string} token @param {string | undefined} code */
    recordFailure(token, code) {
      const id = idOfToken(token);
      if (id === null || !has(id)) return false;
      const rec = store[id];
      const ts = now();
      const said = typeof code === 'string' && code ? code.slice(0, 100) : 'unknown';
      const changed = rec.lastError?.code !== said;
      rec.lastError = { at: ts, code: said };
      if (changed || ts - savedAt >= HOUR_MS) save();
      return true;
    },

    /** Each subscription as the device list shows it: no endpoint, no key. */
    getDevices() {
      return Object.keys(store)
        .map((id) => {
          const rec = store[id];
          return {
            id,
            platform: 'web',
            name: rec.name,
            registeredAt: rec.createdAt,
            lastSeenAt: rec.lastSeenAt,
            ...(rec.lastDeliveredAt !== undefined ? { lastDeliveredAt: rec.lastDeliveredAt } : {}),
            ...(rec.lastError !== undefined ? { lastError: { ...rec.lastError } } : {}),
            prefs: clonePrefs(rec.prefs),
          };
        })
        .sort((a, b) => a.registeredAt - b.registeredAt || a.id.localeCompare(b.id));
    },

    tokenOfDevice,

    /** @param {string} id */
    removeDevice(id) {
      const token = tokenOfDevice(id);
      return token === null ? false : removeToken(token);
    },

    pruneStale(maxAgeMs = STALE_AFTER_MS) {
      const cutoff = now() - maxAgeMs;
      let removed = 0;
      for (const id of Object.keys(store)) {
        if (store[id].lastSeenAt < cutoff) {
          delete store[id];
          removed += 1;
        }
      }
      if (removed > 0) save();
      return removed;
    },
  };
}
