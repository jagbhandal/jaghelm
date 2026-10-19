/**
 * Push-token store for FCM delivery (Phase 4).
 *
 * Mirrors the cron-store persistence idiom: a tolerant JSON load() that never
 * throws on a missing/corrupt file, and atomicWriteFileSync on every mutation.
 * Unlike cron-store this is a FACTORY (createTokenStore) with an injectable
 * `now` so the clock stays out of the determinism-sensitive callers and tests
 * can pin time. Persisted shape: { [token]: record }.
 */
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
    } catch (err) {
      log.error({ err }, 'Failed to save push tokens');
    }
  }

  let store = load();

  function registerToken(token, { platform, appVersion } = {}) {
    const ts = now();
    const existing = Object.prototype.hasOwnProperty.call(store, token) ? store[token] : undefined;
    if (existing) {
      existing.lastSeenAt = ts;
      if (platform !== undefined) existing.platform = platform;
      if (appVersion !== undefined) existing.appVersion = appVersion;
      save(store);
      return { ...existing, prefs: clonePrefs(existing.prefs) };
    }
    const record = {
      platform: platform ?? null,
      appVersion: appVersion ?? null,
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
   * Record that FCM accepted a send to each of these tokens: bump lastSeenAt to now.
   * Unknown tokens are ignored (never re-created). A token seen within the last day
   * is left alone, so a flapping service does not rewrite the file every dispatch.
   * One write for the whole batch, none when nothing changed. Returns the count bumped.
   */
  function markDelivered(tokens) {
    const ts = now();
    let bumped = 0;
    for (const token of tokens) {
      if (!Object.prototype.hasOwnProperty.call(store, token)) continue;
      const rec = store[token];
      if (!rec || ts - rec.lastSeenAt < DAY_MS) continue;
      rec.lastSeenAt = ts;
      bumped += 1;
    }
    if (bumped > 0) save(store);
    return bumped;
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

  return { registerToken, getToken, removeToken, getAllTokens, getPrefs, setPrefs, markDelivered, pruneStale };
}
