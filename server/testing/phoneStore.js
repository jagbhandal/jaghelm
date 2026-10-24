/**
 * Test-only: an in-memory device store with the face the push pipeline reads
 * (the Web Push store's: push/webPushStore.js), for tests that need phones
 * with plain names ('tok-pixel') instead of real subscriptions. Same
 * behaviour where the pipeline can tell: prefs normalised, a delivery clears
 * a failure, a device is listed by its fingerprint (prefs.js deviceIdOf),
 * oldest first, and never by its token.
 */
import { clonePrefs, deviceIdOf, DEFAULT_PREFS, normalizePrefs } from '../push/prefs.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {{ now?: () => number }} [opts] */
export function createPhoneStore({ now = Date.now } = {}) {
  /** @type {Map<string, any>} */
  const phones = new Map();
  const copy = (rec) => ({ ...rec, prefs: clonePrefs(rec.prefs) });

  return {
    registerToken(token, { platform = 'web', name } = {}) {
      const ts = now();
      const existing = phones.get(token);
      if (existing) {
        existing.lastSeenAt = ts;
        return copy(existing);
      }
      const rec = {
        platform,
        ...(name ? { name } : {}),
        registeredAt: ts,
        lastSeenAt: ts,
        prefs: clonePrefs(DEFAULT_PREFS),
      };
      phones.set(token, rec);
      return copy(rec);
    },
    getToken: (token) => (phones.has(token) ? copy(phones.get(token)) : null),
    removeToken: (token) => phones.delete(token),
    getAllTokens: () => [...phones].map(([token, rec]) => ({ token, ...copy(rec) })),
    getPrefs: (token) => (phones.has(token) ? normalizePrefs(phones.get(token).prefs) : clonePrefs(DEFAULT_PREFS)),
    setPrefs(token, prefs) {
      const rec = phones.get(token);
      if (!rec) return null;
      rec.prefs = normalizePrefs(prefs);
      return copy(rec);
    },
    markDelivered(tokens) {
      const ts = now();
      let bumped = 0;
      for (const token of tokens) {
        const rec = phones.get(token);
        if (!rec) continue;
        rec.lastDeliveredAt = ts;
        delete rec.lastError;
        if (ts - rec.lastSeenAt >= DAY_MS) {
          rec.lastSeenAt = ts;
          bumped += 1;
        }
      }
      return bumped;
    },
    recordFailure(token, code) {
      const rec = phones.get(token);
      if (!rec) return false;
      rec.lastError = { at: now(), code: typeof code === 'string' && code ? code : 'unknown' };
      return true;
    },
    getDevices: () =>
      [...phones]
        .map(([token, rec]) => ({ id: deviceIdOf(token), ...copy(rec) }))
        .sort((a, b) => a.registeredAt - b.registeredAt || a.id.localeCompare(b.id)),
    tokenOfDevice: (id) => [...phones.keys()].find((token) => deviceIdOf(token) === id) ?? null,
    removeDevice(id) {
      const token = [...phones.keys()].find((t) => deviceIdOf(t) === id);
      return token === undefined ? false : phones.delete(token);
    },
    pruneStale: () => 0,
  };
}
