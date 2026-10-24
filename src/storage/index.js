/**
 * Async key/value store for secrets (the token): the synchronous localStorage
 * behind an async interface, byte-for-byte as before. A missing key, or no
 * localStorage at all, reads as null.
 */
export const secureStore = {
  async getItem(k) {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(k)) || null;
  },
  async setItem(k, v) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
  },
  async removeItem(k) {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
  },
};

/**
 * A per-browser preference that isn't a secret (the sidebar collapsed, #296):
 * read and written at once, so a screen draws it on its first paint. Backed by
 * localStorage. Never throws: with storage blocked, full or
 * missing, a read gives `fallback` and a write does nothing.
 */
export const prefs = {
  /** The stored string for `key`, or `fallback` when there is none or storage fails. */
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  /** Store `value` (a string) under `key`; null removes it. */
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch {
      // The preference lasts this visit only.
    }
  },
};
