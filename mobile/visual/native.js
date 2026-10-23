/*
 * The Android app's native plugins, for its screenshots in a browser (#546,
 * docs/mobile/DESIGN.md "Android screenshots"). The shots' build
 * (vite.config.visual.js) puts this module in place of every Capacitor plugin
 * the app imports, so the screens, the shell and boot run unchanged and only
 * the boundary to the phone is stubbed:
 *
 *  - storage: the Keystore (capacitor-secure-storage-plugin) and Preferences
 *    are two maps in memory, filled from what the test put in
 *    `window.__JH_NATIVE__` (`{ secure, prefs }`) before the app loaded, so a
 *    state starts signed in, signed out or with a push token as it needs;
 *  - push: nothing registers (the build also turns push off, as a build
 *    without Firebase is), and nothing is ever delivered;
 *  - the app's lifecycle and the network: always in the foreground and online,
 *    and no listener ever fires.
 *
 * Native HTTP needs no stub: in a browser `installNativeHttp()` leaves fetch
 * alone (nativeHttp.js), so the app's requests are fetches the test answers.
 */
const seed = globalThis.__JH_NATIVE__ ?? {};
const secure = new Map(Object.entries(seed.secure ?? {}));
const prefs = new Map(Object.entries(seed.prefs ?? {}));
const handle = Object.freeze({ remove: async () => {} });

/** As the plugin does: a missing key rejects (keystoreAdapter.js turns it into null). */
export const SecureStoragePlugin = {
  async get({ key }) {
    if (!secure.has(key)) throw new Error('Item with given key does not exist');
    return { value: secure.get(key) };
  },
  async set({ key, value }) {
    secure.set(key, String(value));
    return { value: true };
  },
  async remove({ key }) {
    if (!secure.delete(key)) throw new Error('Item with given key does not exist');
    return { value: true };
  },
  async keys() {
    return { value: [...secure.keys()] };
  },
  async clear() {
    secure.clear();
    return { value: true };
  },
};

export const Preferences = {
  async get({ key }) {
    return { value: prefs.has(key) ? prefs.get(key) : null };
  },
  async set({ key, value }) {
    prefs.set(key, String(value));
  },
  async remove({ key }) {
    prefs.delete(key);
  },
  async keys() {
    return { keys: [...prefs.keys()] };
  },
  async clear() {
    prefs.clear();
  },
};

export const App = {
  addListener: async () => handle,
  removeAllListeners: async () => {},
  getState: async () => ({ isActive: true }),
  exitApp: async () => {},
};

export const PushNotifications = {
  checkPermissions: async () => ({ receive: 'denied' }),
  requestPermissions: async () => ({ receive: 'denied' }),
  createChannel: async () => {},
  addListener: async () => handle,
  removeAllListeners: async () => {},
  register: async () => {},
  unregister: async () => {},
};

export const Network = {
  getStatus: async () => ({ connected: true, connectionType: 'wifi' }),
  addListener: async () => handle,
};
