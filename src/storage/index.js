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
