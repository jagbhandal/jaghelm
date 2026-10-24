/**
 * Push-token store for FCM delivery (Phase 4).
 *
 * Mirrors the cron-store persistence idiom: a tolerant JSON load() that never
 * throws on a missing/corrupt file, and atomicWriteFileSync on every mutation.
 * Unlike cron-store this is a FACTORY (createTokenStore) with an injectable
 * `now` so the clock stays out of the determinism-sensitive callers and tests
 * can pin time. Persisted shape: { [token]: record }.
 *
 * A record: platform, appVersion, registeredAt, lastSeenAt (the app's last
 * registration, or an accepted push, below), prefs, and since #320 the phone's
 * `model` and Android version (`os`) when its registration said them
 * (push/devices.js reads them from its User-Agent), when Google last accepted
 * a push for it (`lastDeliveredAt`) and its last failed send (`lastError`,
 * `{ at, code }`, cleared by the next accepted one), for Settings →
 * Notifications' device list. That list names a phone by its fingerprint
 * (deviceIdOf), never its token.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { DATA_DIR } from '../util/dataDir.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('push-tokens');

const DEFAULT_PATH = join(DATA_DIR, 'push-tokens.json');
const DAY_MS = 24 * 60 * 60 * 1000;
// Pruned when FCM names a token dead on send, or after 270 days with no app start and
// no accepted push (lastSeenAt): no sooner than FCM's own 270-day expiry.
const STALE_AFTER_MS = 270 * DAY_MS;
// A delivery's time or a send's error is written at most once an hour unless
// it changes what the file says otherwise (#320): a flapping service sends a
// push every cycle, and the file is not rewritten for each.
const HOUR_MS = 60 * 60 * 1000;

/**
 * A phone's fingerprint (#320): the first 12 hex characters of its token's
 * SHA-256. What Settings → Notifications and its routes name a phone by, so no
 * token leaves the server; it can't be turned back into the token.
 * @param {string} token
 */
export function deviceIdOf(token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}

/** A model or Android version as kept: a short trimmed string, or undefined. */
const shortText = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : undefined);

/** Default notification preferences seeded for every newly-registered token. */
export const DEFAULT_PREFS = Object.freeze({
  categories: Object.freeze({ service: true, host: true, ups: true, cron: true, watchtower: true }),
  notifyRecoveries: true,
  enabled: true,
});

/** Deep copy of a prefs object so callers can never mutate stored state. */
function clonePrefs(prefs) {
  return { ...prefs, categories: { ...prefs.categories } };
}

/** Deep, plain (unfrozen) clone of DEFAULT_PREFS so callers can mutate safely. */
const defaultPrefs = () => clonePrefs(DEFAULT_PREFS);

export const CATEGORY_KEYS = ['service', 'host', 'ups', 'cron', 'watchtower'];

/**
 * Coerce arbitrary input into a valid PREFS object. Unknown keys are dropped,
 * missing keys fall back to DEFAULT_PREFS, all flags coerce to boolean. Pure.
 */
function normalizePrefs(input) {
  const src = input && typeof input === 'object' ? input : {};
  const srcCats = src.categories && typeof src.categories === 'object' ? src.categories : {};
  const categories = {};
  for (const k of CATEGORY_KEYS) {
    categories[k] = k in srcCats ? Boolean(srcCats[k]) : DEFAULT_PREFS.categories[k];
  }
  return {
    categories,
    notifyRecoveries: 'notifyRecoveries' in src ? Boolean(src.notifyRecoveries) : DEFAULT_PREFS.notifyRecoveries,
    enabled: 'enabled' in src ? Boolean(src.enabled) : DEFAULT_PREFS.enabled,
  };
}

export function createTokenStore({ path = DEFAULT_PATH, now = Date.now } = {}) {
  /** @type {Record<string, any>} Tolerant load: missing/corrupt => null-proto map. */
  function load() {
    try {
      if (!existsSync(path)) return Object.create(null);
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Rebuild into a null-proto map so inherited keys (__proto__ etc.) can
        // never be accessed via a bare store[key] lookup. One damaged record must not
        // throw in getAllTokens/pruneStale (that stops every push cycle): drop
        // non-objects, repair the rest.
        const safe = Object.create(null);
        for (const k of Object.keys(parsed)) {
          const rec = parsed[k];
          if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
          // An unreadable lastSeenAt is not evidence the token is dead: restart its clock.
          if (!Number.isFinite(rec.lastSeenAt)) rec.lastSeenAt = now();
          rec.prefs = normalizePrefs(rec.prefs);
          // #320's fields: one that can't be read goes, rather than reach the device list.
          if (rec.lastDeliveredAt !== undefined && !Number.isFinite(rec.lastDeliveredAt)) delete rec.lastDeliveredAt;
          const err = rec.lastError;
          if (err !== undefined && !(err && Number.isFinite(err.at) && typeof err.code === 'string')) delete rec.lastError;
          for (const key of ['model', 'os']) if (rec[key] !== undefined && !shortText(rec[key])) delete rec[key];
          safe[k] = rec;
        }
        return safe;
      }
      return Object.create(null);
    } catch {
      return Object.create(null);
    }
  }

  function save(storeData) {
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      atomicWriteFileSync(path, JSON.stringify(storeData, null, 2));
      savedAt = now();
    } catch (err) {
      log.error({ err }, 'Failed to save push tokens');
    }
  }

  let store = load();
  let savedAt = -Infinity; // when this store last wrote the file

  function registerToken(token, { platform, appVersion, model, os } = {}) {
    const ts = now();
    const existing = Object.prototype.hasOwnProperty.call(store, token) ? store[token] : undefined;
    if (existing) {
      existing.lastSeenAt = ts;
      if (platform !== undefined) existing.platform = platform;
      if (appVersion !== undefined) existing.appVersion = appVersion;
      if (shortText(model)) existing.model = shortText(model);
      if (shortText(os)) existing.os = shortText(os);
      save(store);
      return { ...existing, prefs: clonePrefs(existing.prefs) };
    }
    const record = {
      platform: platform ?? null,
      appVersion: appVersion ?? null,
      ...(shortText(model) ? { model: shortText(model) } : {}),
      ...(shortText(os) ? { os: shortText(os) } : {}),
      registeredAt: ts,
      lastSeenAt: ts,
      prefs: defaultPrefs(),
    };
    // Use defineProperty so that even if `token` is '__proto__' the value is
    // stored as an OWN enumerable property on the null-proto map, not as a
    // prototype mutation.
    Object.defineProperty(store, token, { value: record, writable: true, enumerable: true, configurable: true });
    save(store);
    return { ...record, prefs: clonePrefs(record.prefs) };
  }

  function getToken(token) {
    if (!Object.prototype.hasOwnProperty.call(store, token)) return null;
    const rec = store[token];
    return rec ? { ...rec, prefs: clonePrefs(rec.prefs) } : null;
  }

  function removeToken(token) {
    if (!Object.prototype.hasOwnProperty.call(store, token)) return false;
    delete store[token];
    save(store);
    return true;
  }

  function getAllTokens() {
    return Object.keys(store).map((token) => {
      const rec = store[token];
      return { token, ...rec, prefs: clonePrefs(rec.prefs) };
    });
  }

  function getPrefs(token) {
    if (!Object.prototype.hasOwnProperty.call(store, token)) return defaultPrefs();
    const rec = store[token];
    if (!rec || !rec.prefs) return defaultPrefs();
    return normalizePrefs(rec.prefs);
  }

  function setPrefs(token, prefs) {
    if (!Object.prototype.hasOwnProperty.call(store, token)) return null;
    const rec = store[token];
    if (!rec) return null;
    rec.prefs = normalizePrefs(prefs);
    save(store);
    return { ...rec, prefs: clonePrefs(rec.prefs) };
  }

  /**
   * Record that FCM accepted a send to each of these tokens: its lastDeliveredAt
   * is now and its lastError goes (#320), and lastSeenAt is bumped to now unless
   * it was within the last day. Unknown tokens are ignored (never re-created).
   * One write for the whole batch, when a lastSeenAt was bumped or an error
   * cleared, or else at most once an hour, so a flapping service does not
   * rewrite the file every dispatch: a restart loses at most an hour of
   * delivery times. Returns the count of lastSeenAt bumped.
   */
  function markDelivered(tokens) {
    const ts = now();
    let bumped = 0;
    let delivered = 0;
    let cleared = 0;
    for (const token of tokens) {
      if (!Object.prototype.hasOwnProperty.call(store, token)) continue;
      const rec = store[token];
      if (!rec) continue;
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
    if (bumped > 0 || cleared > 0 || (delivered > 0 && ts - savedAt >= HOUR_MS)) save(store);
    return bumped;
  }

  /**
   * Record a failed send to `token` (#320): its lastError is `{ at, code }`,
   * FCM's code as fcm.js gives it. Written when the code is new for it, or at
   * most once an hour while one phone keeps failing alike. False for a token
   * the store doesn't have.
   *
   * @param {string} token
   * @param {string | undefined} code
   */
  function recordFailure(token, code) {
    if (!Object.prototype.hasOwnProperty.call(store, token)) return false;
    const rec = store[token];
    if (!rec) return false;
    const ts = now();
    const said = typeof code === 'string' && code ? code.slice(0, 100) : 'unknown';
    const changed = rec.lastError?.code !== said;
    rec.lastError = { at: ts, code: said };
    if (changed || ts - savedAt >= HOUR_MS) save(store);
    return true;
  }

  /**
   * Every phone as Settings → Notifications lists it (#320): its record
   * without the token, under its fingerprint (`id`, deviceIdOf), oldest
   * registration first.
   */
  function getDevices() {
    return Object.keys(store)
      .map((token) => {
        const rec = store[token];
        return { id: deviceIdOf(token), ...rec, prefs: clonePrefs(rec.prefs) };
      })
      .sort((a, b) => a.registeredAt - b.registeredAt || a.id.localeCompare(b.id));
  }

  /** The token of the phone with fingerprint `id`, or null (none, or a malformed id). */
  function tokenOfDevice(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{12}$/.test(id)) return null;
    return Object.keys(store).find((token) => deviceIdOf(token) === id) ?? null;
  }

  /** Remove the phone with fingerprint `id` (#320); false when there is none. */
  function removeDevice(id) {
    const token = tokenOfDevice(id);
    return token === null ? false : removeToken(token);
  }

  function pruneStale(maxAgeMs = STALE_AFTER_MS) {
    const cutoff = now() - maxAgeMs;
    let removed = 0;
    for (const token of Object.keys(store)) {
      // load() guarantees a numeric lastSeenAt; register/markDelivered only set numbers.
      if (store[token].lastSeenAt < cutoff) {
        delete store[token];
        removed += 1;
      }
    }
    if (removed > 0) save(store);
    return removed;
  }

  return {
    registerToken,
    getToken,
    removeToken,
    getAllTokens,
    getPrefs,
    setPrefs,
    markDelivered,
    recordFailure,
    getDevices,
    tokenOfDevice,
    removeDevice,
    pruneStale,
  };
}
