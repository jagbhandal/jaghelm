import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so the mock fns are referenced inside the hoisted vi.mock factory.
// `removeAllListeners` + `routeFromData` are used by Task 6/6b — declared here
// ONCE so the hoisted mock block is complete and not retrofitted mid-file.
const plugin = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  register: vi.fn(),
  addListener: vi.fn(),
  createChannel: vi.fn(),
  removeAllListeners: vi.fn(),
  unregister: vi.fn(),
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }));

// @capacitor/app App.addListener('appUrlOpen', ...) — the custom-scheme path B.
const appPlugin = vi.hoisted(() => ({ addListener: vi.fn() }));
vi.mock('@capacitor/app', () => ({ App: appPlugin }));

// ALL mock fns referenced inside a vi.mock factory use vi.hoisted() — vi.mock is
// hoisted above the file's top, so a plain `const` referenced in the factory
// would sit in its temporal dead zone (the TDZ trap). vi.hoisted() lifts the fn
// to the same level as the mock, eliminating the risk uniformly.
const { setPref, getPref } = vi.hoisted(() => ({ setPref: vi.fn(), getPref: vi.fn() }));
vi.mock('../storage/prefsAdapter.js', () => ({ setPref, getPref }));

const { registerToken, deleteToken } = vi.hoisted(() => ({
  registerToken: vi.fn(),
  deleteToken: vi.fn(),
}));
vi.mock('./pushPrefsApi.js', () => ({ registerToken, deleteToken }));

// routeFromData/routeFromUrl mocked here so Task 6/6b can assert on them without
// retrofitting the mock list. They are their own modules (not on `plugin`), so
// the beforeEach Object.values(plugin) reset does not touch them — reset them
// explicitly below.
const routeFromData = vi.hoisted(() => vi.fn());
const routeFromUrl = vi.hoisted(() => vi.fn());
vi.mock('./routeFromData.js', () => ({ routeFromData }));
vi.mock('./routeFromUrl.js', () => ({ routeFromUrl }));

// Build-time push-configured gate. Default ON for the existing flow tests; the
// gate test below flips it OFF.
const { isPushConfigured } = vi.hoisted(() => ({ isPushConfigured: vi.fn(() => true) }));
vi.mock('./pushConfig.js', () => ({ isPushConfigured }));

// The pending cleanup (#539) has its own tests (auth/pendingCleanup.test.jsx);
// here it is spies, with the real outcomeOf.
const cleanup = vi.hoisted(() => ({
  expectRegistration: vi.fn(),
  noRegistration: vi.fn(),
  supersedePush: vi.fn(),
  rememberCleanup: vi.fn(),
  isOnline: vi.fn(),
}));
vi.mock('../auth/pendingCleanup.js', async (importOriginal) => {
  const { outcomeOf } = await importOriginal();
  return { ...cleanup, outcomeOf };
});

import {
  initPush,
  disablePush,
  enablePush,
  pushWanted,
  unregisterPush,
  cachedPushToken,
  ENABLE_WAIT_MS,
} from './registerPush.js';
import { SIGN_OUT_TIMEOUT_MS, setAuthToken } from '@shared/api/client.js';
import { setApiBase } from '@shared/api/baseUrl.js';

beforeEach(() => {
  for (const f of Object.values(plugin)) f.mockReset();
  appPlugin.addListener.mockReset().mockResolvedValue({ remove: vi.fn() });
  routeFromData.mockReset();
  routeFromUrl.mockReset();
  setPref.mockReset().mockResolvedValue(undefined);
  getPref.mockReset().mockResolvedValue('');
  registerToken.mockReset().mockResolvedValue({ stored: true, deliveryEnabled: true });
  deleteToken.mockReset().mockResolvedValue({ removed: true });
  plugin.addListener.mockResolvedValue({ remove: vi.fn() });
  plugin.register.mockResolvedValue(undefined);
  plugin.createChannel.mockResolvedValue(undefined);
  isPushConfigured.mockReset().mockReturnValue(true);
  cleanup.expectRegistration.mockReset().mockResolvedValue(undefined);
  cleanup.noRegistration.mockReset();
  cleanup.supersedePush.mockReset().mockResolvedValue(undefined);
  cleanup.isOnline.mockReset().mockResolvedValue(true);
  // Awaits the teardown it is given, as the real one does.
  cleanup.rememberCleanup.mockReset().mockImplementation(async ({ push }) => {
    await push;
  });
});

// The phone's Preferences, kept across a "restart" (a fresh module instance).
function prefsStore(initial = {}) {
  const store = new Map(Object.entries(initial));
  getPref.mockImplementation(async (k) => (store.has(k) ? store.get(k) : null));
  setPref.mockImplementation(async (k, v) => {
    store.set(k, String(v));
  });
  return store;
}

describe('initPush build-config gate', () => {
  it('when push is NOT configured (no google-services.json build), returns disabled and never touches the plugin', async () => {
    isPushConfigured.mockReturnValue(false);
    const r = await initPush({ nav: { push: vi.fn() } });
    expect(r).toEqual({ enabled: false, reason: 'not-configured' });
    // register() without Firebase throws an uncaught NATIVE exception that crashes
    // the app — so it (and every other push call) must NOT run.
    expect(plugin.checkPermissions).not.toHaveBeenCalled();
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(plugin.register).not.toHaveBeenCalled();
    expect(plugin.addListener).not.toHaveBeenCalled();
  });
});

describe('initPush permission gate', () => {
  it('prompts when state is "prompt", then registers on grant', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    plugin.requestPermissions.mockResolvedValue({ receive: 'granted' });
    const r = await initPush({ nav: { push: vi.fn() } });
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(plugin.register).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ enabled: true, permission: 'granted' });
  });

  it('does NOT re-prompt when already granted', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    await initPush({ nav: { push: vi.fn() } });
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(plugin.register).toHaveBeenCalledTimes(1);
  });

  it('early-returns disabled on deny: no listeners, no channel, no register', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    plugin.requestPermissions.mockResolvedValue({ receive: 'denied' });
    const r = await initPush({ nav: { push: vi.fn() } });
    expect(r).toEqual({ enabled: false, permission: 'denied' });
    expect(plugin.addListener).not.toHaveBeenCalled();
    expect(appPlugin.addListener).not.toHaveBeenCalled(); // no appUrlOpen on deny
    expect(plugin.createChannel).not.toHaveBeenCalled();
    expect(plugin.register).not.toHaveBeenCalled();
    expect(setPref).toHaveBeenCalledWith('jaghelm-push-perm', 'denied');
    // Nothing registers: a pending FCM token deletion may run again (#539).
    expect(cleanup.noRegistration).toHaveBeenCalledTimes(1);
    expect(cleanup.supersedePush).not.toHaveBeenCalled();
  });

  it('creates the jaghelm-incidents channel and adds 4 plugin listeners + appUrlOpen BEFORE register()', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    const order = [];
    plugin.createChannel.mockImplementation((c) => { order.push(`channel:${c.id}`); return Promise.resolve(); });
    plugin.addListener.mockImplementation((ev) => { order.push(`listen:${ev}`); return Promise.resolve({ remove: vi.fn() }); });
    appPlugin.addListener.mockImplementation((ev) => { order.push(`applisten:${ev}`); return Promise.resolve({ remove: vi.fn() }); });
    plugin.register.mockImplementation(() => { order.push('register'); return Promise.resolve(); });
    await initPush({ nav: { push: vi.fn() } });
    expect(order).toContain('channel:jaghelm-incidents');
    const listened = order.filter((o) => o.startsWith('listen:')).map((o) => o.slice(7));
    // exactly the four plugin listeners are added
    expect(listened.slice().sort()).toEqual([
      'pushNotificationActionPerformed', 'pushNotificationReceived', 'registration', 'registrationError',
    ]);
    // the appUrlOpen custom-scheme listener is also registered
    expect(order).toContain('applisten:appUrlOpen');
    // HARD ordering: register() comes AFTER every listener (plugin + app) was
    // added (and is last).
    const registerIdx = order.indexOf('register');
    const lastListenIdx = order.map((o) => o.startsWith('listen:') || o.startsWith('applisten:')).lastIndexOf(true);
    expect(registerIdx).toBeGreaterThan(lastListenIdx);
    expect(order[order.length - 1]).toBe('register');
    expect(setPref).toHaveBeenCalledWith('jaghelm-push-perm', 'granted');
  });
});

// routeFromData is already imported as the hoisted mock at the top of the file
// (Task 5). Reference it directly in assertions.

function captureHandlers() {
  const handlers = {};
  plugin.addListener.mockImplementation((event, cb) => {
    handlers[event] = cb;
    return Promise.resolve({ remove: vi.fn() });
  });
  return handlers;
}

describe('registration handler + listeners (captured)', () => {
  it("'registration' persists token.value and POSTs it to the backend", async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    const handlers = captureHandlers();
    await initPush({ nav: { push: vi.fn() } });
    await handlers.registration({ value: 'fake-fcm-token' });
    expect(setPref).toHaveBeenCalledWith('jaghelm-push-token', 'fake-fcm-token');
    expect(registerToken).toHaveBeenCalledWith('fake-fcm-token');
  });

  it("'registration' with a backend failure does NOT throw (logged)", async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    registerToken.mockRejectedValueOnce(new Error('500'));
    const handlers = captureHandlers();
    await initPush({ nav: { push: vi.fn() } });
    await expect(handlers.registration({ value: 't' })).resolves.toBeUndefined();
  });

  it("'registrationError' does not throw", async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    const handlers = captureHandlers();
    await initPush({ nav: { push: vi.fn() } });
    expect(() => handlers.registrationError({ error: 'boom' })).not.toThrow();
  });

  it("'pushNotificationActionPerformed' deep-links via routeFromData with the data block", async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    const nav = { push: vi.fn() };
    const handlers = captureHandlers();
    await initPush({ nav });
    const data = { type: 'service_down', id: 'vm-101:nginx', node: 'vm-101', severity: 'critical' };
    handlers.pushNotificationActionPerformed({ actionId: 'tap', notification: { data } });
    expect(routeFromData).toHaveBeenCalledWith(data, nav);
  });
});

describe('disablePush teardown', () => {
  it('stores the choice first, removes listeners, DELETEs the token, deletes the FCM token, clears the local one', async () => {
    const seen = [];
    setPref.mockImplementation(async (k, v) => seen.push(`setPref ${k}=${v}`));
    deleteToken.mockImplementation(async (t) => seen.push(`DELETE ${t}`));
    plugin.removeAllListeners.mockImplementation(async () => seen.push('removeAllListeners'));
    plugin.unregister.mockImplementation(async () => seen.push('unregister'));
    await disablePush('fcmtok');
    expect(seen).toEqual([
      'setPref jaghelm-push-wanted=false',
      'DELETE fcmtok',
      'removeAllListeners',
      'unregister',
      'setPref jaghelm-push-token=',
    ]);
  });

  it('hands what it started to the pending cleanup: this session, this server, no revoke', async () => {
    setApiBase('http://vm-101:3099/api');
    setAuthToken('live-tok');
    try {
      await disablePush('fcmtok');
      expect(cleanup.rememberCleanup).toHaveBeenCalledTimes(1);
      const [arg] = cleanup.rememberCleanup.mock.calls[0];
      expect(arg).toEqual({
        serverUrl: 'http://vm-101:3099/api',
        sessionToken: 'live-tok',
        pushToken: 'fcmtok',
        push: expect.any(Promise),
      });
      await expect(arg.push).resolves.toEqual({ deleted: 'done', unregistered: true });
    } finally {
      setApiBase('/api');
      setAuthToken('');
    }
  });

  it('still clears local state when the backend DELETE fails (does not throw)', async () => {
    deleteToken.mockRejectedValueOnce(new Error('500'));
    await expect(disablePush('fcmtok')).resolves.toBeUndefined();
    expect(setPref).toHaveBeenCalledWith('jaghelm-push-token', '');
  });

  it('in a build without push stores the choice and touches nothing else', async () => {
    isPushConfigured.mockReturnValue(false);
    await disablePush('fcmtok');
    expect(setPref).toHaveBeenCalledWith('jaghelm-push-wanted', 'false');
    expect(deleteToken).not.toHaveBeenCalled();
    expect(plugin.unregister).not.toHaveBeenCalled();
    expect(cleanup.rememberCleanup).not.toHaveBeenCalled();
  });
});

describe('the push choice sticks (#539)', () => {
  it('Turn off push, restart: still off, and no registration is sent', async () => {
    const store = prefsStore({ 'jaghelm-push-token': 'fcmtok' });
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    await disablePush('fcmtok');
    expect(store.get('jaghelm-push-wanted')).toBe('false');

    vi.resetModules(); // the app starts again: a fresh module, the same Preferences
    const restarted = await import('./registerPush.js');
    const r = await restarted.initPush({ nav: { push: vi.fn() } });
    expect(r).toEqual({ enabled: false, reason: 'turned-off' });
    expect(plugin.checkPermissions).not.toHaveBeenCalled(); // no prompt either
    expect(plugin.addListener).not.toHaveBeenCalled();
    expect(plugin.register).not.toHaveBeenCalled();
    expect(registerToken).not.toHaveBeenCalled();
  });

  it('permission granted is not push wanted: off never registers, whatever Android allows', async () => {
    prefsStore({ 'jaghelm-push-wanted': 'false' });
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    await initPush({ nav: { push: vi.fn() } });
    expect(plugin.register).not.toHaveBeenCalled();
  });

  it('on by default: no stored choice registers as before', async () => {
    prefsStore();
    await expect(pushWanted()).resolves.toBe(true);
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    await initPush({ nav: { push: vi.fn() } });
    expect(plugin.register).toHaveBeenCalledTimes(1);
  });

  it('Turn off push sends the DELETE and deletes the FCM token; Turn on registers a new token', async () => {
    const store = prefsStore({ 'jaghelm-push-token': 'fcmtok' });
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    const handlers = captureHandlers();
    await disablePush('fcmtok');
    expect(deleteToken).toHaveBeenCalledWith('fcmtok');
    expect(plugin.unregister).toHaveBeenCalledTimes(1);
    expect(store.get('jaghelm-push-token')).toBe('');

    // register() brings the fresh token, as the plugin does.
    plugin.register.mockImplementation(async () => {
      handlers.registration({ value: 'fcmtok-new' });
    });
    const r = await enablePush({ nav: { push: vi.fn() } });
    expect(store.get('jaghelm-push-wanted')).toBe('true');
    expect(plugin.register).toHaveBeenCalledTimes(1);
    expect(registerToken).toHaveBeenCalledWith('fcmtok-new');
    expect(store.get('jaghelm-push-token')).toBe('fcmtok-new');
    expect(r).toEqual({ enabled: true, permission: 'granted', token: 'fcmtok-new' });
  });

  it('Turn on answers no token when none comes within ENABLE_WAIT_MS', async () => {
    vi.useFakeTimers();
    try {
      prefsStore({ 'jaghelm-push-wanted': 'false' });
      plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
      let done;
      enablePush({ nav: { push: vi.fn() } }).then((r) => (done = r));
      await vi.advanceTimersByTimeAsync(ENABLE_WAIT_MS - 1);
      expect(done).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toEqual({ enabled: true, permission: 'granted', token: '' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('Turn on with the permission off in Android answers why, without waiting', async () => {
    prefsStore({ 'jaghelm-push-wanted': 'false' });
    plugin.checkPermissions.mockResolvedValue({ receive: 'denied' });
    await expect(enablePush({ nav: { push: vi.fn() } })).resolves.toEqual({
      enabled: false,
      permission: 'denied',
    });
  });

  it('holds the FCM token deletion before the permission prompt, and supersedes the push steps before registering', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    setApiBase('http://vm-101:3099/api');
    const order = [];
    cleanup.expectRegistration.mockImplementation(async () => order.push('hold'));
    plugin.requestPermissions.mockImplementation(async () => {
      order.push('prompt');
      return { receive: 'granted' };
    });
    cleanup.supersedePush.mockImplementation(async (base) => order.push(`supersede ${base}`));
    plugin.addListener.mockImplementation(async (ev) => {
      order.push(`listen ${ev}`);
      return { remove: vi.fn() };
    });
    plugin.register.mockImplementation(async () => order.push('register'));
    try {
      await initPush({ nav: { push: vi.fn() } });
    } finally {
      setApiBase('/api');
    }
    expect(order.slice(0, 4)).toEqual([
      'hold',
      'prompt',
      'supersede http://vm-101:3099/api',
      'listen registration',
    ]);
    expect(order.at(-1)).toBe('register');
    expect(cleanup.noRegistration).not.toHaveBeenCalled();
  });
});

describe('sign-out push teardown (#531)', () => {
  // What the server and the plugin saw, in order.
  let seen;
  beforeEach(() => {
    seen = [];
    deleteToken.mockImplementation(async (t) => {
      seen.push(`DELETE ${t}`);
      return { removed: true };
    });
    plugin.removeAllListeners.mockImplementation(async () => seen.push('removeAllListeners'));
    plugin.unregister.mockImplementation(async () => seen.push('unregister'));
    setPref.mockImplementation(async (k, v) => seen.push(`setPref ${k}=${v}`));
  });

  it('cachedPushToken reads the FCM token the registration handler stored', async () => {
    getPref.mockResolvedValue('fcmtok');
    await expect(cachedPushToken()).resolves.toBe('fcmtok');
    expect(getPref).toHaveBeenCalledWith('jaghelm-push-token');
  });

  it('cachedPushToken answers "" when there is none or the read fails', async () => {
    getPref.mockResolvedValue(null);
    await expect(cachedPushToken()).resolves.toBe('');
    getPref.mockRejectedValue(new Error('read failed'));
    await expect(cachedPushToken()).resolves.toBe('');
  });

  it('sends the DELETE within the call, then removes the listeners, deletes the FCM token and clears the cached one', async () => {
    const pending = unregisterPush('fcmtok');
    expect(seen[0]).toBe('DELETE fcmtok'); // sent before the call first yields
    await expect(pending).resolves.toEqual({ deleted: 'done', unregistered: true });
    expect(seen).toEqual([
      'DELETE fcmtok',
      'removeAllListeners',
      'unregister',
      'setPref jaghelm-push-token=',
    ]);
  });

  it('with no cached token sends nothing but still tears push down on the phone', async () => {
    await unregisterPush('');
    expect(deleteToken).not.toHaveBeenCalled();
    expect(seen).toEqual(['removeAllListeners', 'unregister', 'setPref jaghelm-push-token=']);
  });

  it('touches nothing in a build without push (the plugin would crash the app)', async () => {
    isPushConfigured.mockReturnValue(false);
    await expect(unregisterPush('fcmtok')).resolves.toEqual({ deleted: 'done', unregistered: true });
    expect(seen).toEqual([]);
  });

  it.each([
    ['a 401 (the session is already gone)', Object.assign(new Error('401'), { status: 401 }), 'gone'],
    ['a 404 (it never will)', Object.assign(new Error('404'), { status: 404 }), 'done'],
    ['a 502', Object.assign(new Error('502'), { status: 502 }), 'failed'],
    ['a network error', new TypeError('Failed to fetch'), 'failed'],
  ])('says what the DELETE met: %s', async (_what, err, deleted) => {
    deleteToken.mockRejectedValue(err);
    await expect(unregisterPush('fcmtok')).resolves.toEqual({ deleted, unregistered: true });
  });

  it('a failed DELETE still tears push down and never rejects', async () => {
    deleteToken.mockRejectedValue(Object.assign(new Error('push API HTTP 500'), { status: 500 }));
    await expect(unregisterPush('fcmtok')).resolves.toEqual({ deleted: 'failed', unregistered: true });
    expect(seen).toEqual(['removeAllListeners', 'unregister', 'setPref jaghelm-push-token=']);
  });

  it('a teardown step that throws skips none of the others and never rejects', async () => {
    plugin.removeAllListeners.mockRejectedValue(new Error('native failure'));
    plugin.unregister.mockRejectedValue(new Error('native failure'));
    await expect(unregisterPush('fcmtok')).resolves.toEqual({ deleted: 'done', unregistered: false });
    expect(plugin.unregister).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['DELETE fcmtok', 'setPref jaghelm-push-token=']);
  });

  it('a cached-token write that fails never rejects', async () => {
    setPref.mockRejectedValue(new Error('preferences write failed'));
    await expect(unregisterPush('fcmtok')).resolves.toEqual({ deleted: 'done', unregistered: true });
  });

  it('counts the FCM token deletion done only when the phone was online as it asked', async () => {
    cleanup.isOnline.mockImplementation(async () => {
      seen.push('network?');
      return false;
    });
    await expect(unregisterPush('fcmtok')).resolves.toEqual({ deleted: 'done', unregistered: false });
    // Read before unregister(), not once the DELETE has answered or timed out.
    expect(seen).toEqual(['DELETE fcmtok', 'removeAllListeners', 'network?', 'unregister', 'setPref jaghelm-push-token=']);
  });

  it('a DELETE the server never answers: tears down at once, settles after the sign-out bound', async () => {
    vi.useFakeTimers();
    try {
      deleteToken.mockImplementation(() => new Promise(() => {}));
      let done = false;
      unregisterPush('fcmtok').then((r) => (done = r));
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toEqual(['removeAllListeners', 'unregister', 'setPref jaghelm-push-token=']);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(SIGN_OUT_TIMEOUT_MS);
      expect(done).toEqual({ deleted: 'failed', unregistered: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('listeners do not stack across sign-ins (#531)', () => {
  // A plugin that keeps its listeners as the native one does: each handle
  // removes its own, and removeAllListeners only reaches PushNotifications'.
  let live;
  beforeEach(() => {
    live = [];
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    const add = (where) => (event) => {
      const entry = `${where}:${event}`;
      live.push(entry);
      return Promise.resolve({ remove: vi.fn(async () => live.splice(live.indexOf(entry), 1)) });
    };
    plugin.addListener.mockImplementation(add('push'));
    appPlugin.addListener.mockImplementation(add('app'));
    plugin.removeAllListeners.mockImplementation(async () => {
      live = live.filter((e) => !e.startsWith('push:'));
    });
  });

  const ONE_OF_EACH = [
    'app:appUrlOpen',
    'push:pushNotificationActionPerformed',
    'push:pushNotificationReceived',
    'push:registration',
    'push:registrationError',
  ];

  it('two sign-ins leave one listener of each kind', async () => {
    await initPush({ nav: { push: vi.fn() } });
    await initPush({ nav: { push: vi.fn() } });
    expect(live.slice().sort()).toEqual(ONE_OF_EACH);
  });

  it('sign-out removes every listener, appUrlOpen too, and the next sign-in adds one of each', async () => {
    await initPush({ nav: { push: vi.fn() } });
    await unregisterPush('fcmtok');
    expect(live).toEqual([]);
    await initPush({ nav: { push: vi.fn() } });
    expect(live.slice().sort()).toEqual(ONE_OF_EACH);
  });

  it('a removeAllListeners that throws still removes appUrlOpen at sign-out', async () => {
    await initPush({ nav: { push: vi.fn() } });
    plugin.removeAllListeners.mockRejectedValue(new Error('native failure'));
    await expect(unregisterPush('fcmtok')).resolves.toBeDefined();
    expect(live).not.toContain('app:appUrlOpen');
  });
});

function captureAppHandlers() {
  const handlers = {};
  appPlugin.addListener.mockImplementation((event, cb) => {
    handlers[event] = cb;
    return Promise.resolve({ remove: vi.fn() });
  });
  return handlers;
}

describe('appUrlOpen custom-scheme deep-link (path B)', () => {
  it('registers an appUrlOpen listener that routes via routeFromUrl with the live nav', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    const nav = { push: vi.fn() };
    const appHandlers = captureAppHandlers();
    await initPush({ nav });
    expect(appHandlers.appUrlOpen).toBeTypeOf('function');
    appHandlers.appUrlOpen({ url: 'jaghelm://incident/vm-101%3Anginx?type=service_down&node=vm-101&severity=critical' });
    expect(routeFromUrl).toHaveBeenCalledWith(
      'jaghelm://incident/vm-101%3Anginx?type=service_down&node=vm-101&severity=critical',
      nav,
    );
  });
});
