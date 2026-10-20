/**
 * Storage adapter seam. Web (default) wraps the synchronous localStorage behind
 * an async interface so the mobile adapter (Android Keystore via a Capacitor
 * secure-storage plugin, a later phase) is a drop-in: same async shape, swapped
 * via setStorageAdapter(). Secrets (token, backend URL) flow through secureStore;
 * desktop persistence is byte-for-byte as before (it still reads/writes
 * localStorage).
 */
export const webStorage = {
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

let impl = webStorage;

/** Swap the backing storage implementation (mobile passes a Keystore adapter). */
export function setStorageAdapter(a) {
  impl = a;
}

/** Async secure key/value store. Web default = localStorage; mobile = Keystore. */
export const secureStore = {
  getItem: (k) => impl.getItem(k),
  setItem: (k, v) => impl.setItem(k, v),
  removeItem: (k) => impl.removeItem(k),
};

/**
 * A per-browser preference that isn't a secret (the sidebar collapsed, #296):
 * read and written at once, so a screen draws it on its first paint. Backed by
 * localStorage on both apps. Never throws: with storage blocked, full or
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
