import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

// A sign-out or Turn off push that couldn't finish is kept and finished later
// (#539). These run the real sign-out (App.jsx), login, push teardown, client
// and pending cleanup over a fake phone: a Keystore and Preferences in memory,
// a mocked push plugin, a Network plugin the test switches, and fake servers.

const phone = vi.hoisted(() => ({
  secure: new Map(),
  prefs: new Map(),
  connected: true,
  onConnection: [],
}));
vi.mock('@shared/storage/index.js', () => ({
  secureStore: {
    getItem: async (k) => (phone.secure.has(k) ? phone.secure.get(k) : null),
    setItem: async (k, v) => void phone.secure.set(k, String(v)),
    removeItem: async (k) => void phone.secure.delete(k),
  },
}));
vi.mock('../storage/prefsAdapter.js', () => ({
  getPref: async (k) => (phone.prefs.has(k) ? phone.prefs.get(k) : null),
  setPref: async (k, v) => void phone.prefs.set(k, String(v)),
}));
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: async () => ({ connected: phone.connected }),
    addListener: async (event, cb) => {
      if (event === 'networkStatusChange') phone.onConnection.push(cb);
      return { remove: async () => {} };
    },
  },
}));
const plugin = vi.hoisted(() => ({
  unregister: vi.fn(),
  removeAllListeners: vi.fn(),
  addListener: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  createChannel: vi.fn(),
  register: vi.fn(),
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: async () => {} }) } }));
vi.mock('../push/pushConfig.js', () => ({ isPushConfigured: () => true }));
vi.mock('../MobileApp.jsx', () => ({ default: () => <div>THE_APP</div> }));
vi.mock('../Login.jsx', () => ({ default: () => <div>LOGIN</div> }));

const A = 'http://vm-101:3099/api';
const B = 'http://vm-102:3099/api';
const KEY = 'jaghelm-pending-cleanup';
const DAY = 24 * 60 * 60 * 1000;

// The servers: every request is logged; a host in `down` (or every host while
// the phone is offline) refuses; `answers` overrides a status by "METHOD url".
let requests;
let down;
let answers;
function serve(url, opts = {}) {
  const method = opts.method || 'GET';
  const sent = { method, url, token: opts.headers?.['x-auth-token'], body: opts.body ? JSON.parse(opts.body) : undefined };
  requests.push(sent);
  const host = new URL(url).origin;
  if (!phone.connected || down.has(host)) return Promise.reject(new TypeError('Failed to fetch'));
  const status = answers[`${method} ${url}`] ?? (url.endsWith('/auth/logout') ? 204 : 200);
  if (status === 204) return Promise.resolve(new Response(null, { status }));
  const body = url.endsWith('/auth/login') ? { token: 't-new' } : {};
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}
const calls = (method, url) => requests.filter((r) => r.method === method && r.url === url);
const record = () => (phone.secure.has(KEY) ? JSON.parse(phone.secure.get(KEY)) : null);

// A fresh app (module state included), signed in to A with token t-old and
// FCM token fcm-old, after boot started the cleanup.
let m;
async function startApp() {
  vi.resetModules();
  m = {
    client: await import('@shared/api/client.js'),
    base: await import('@shared/api/baseUrl.js'),
    cleanup: await import('./pendingCleanup.js'),
    authState: await import('./authState.js'),
    push: await import('../push/registerPush.js'),
    login: (await import('../login.js')).login,
    App: (await import('../App.jsx')).default,
  };
  m.base.setApiBase(A);
  m.client.setAuthToken('t-old');
  await m.cleanup.startPendingCleanup();
}

async function signOut(how = 'logout') {
  render(<m.App initial={{ hasUrl: true, hasToken: true, baseUrl: A }} />);
  await act(async () => {
    await m.authState[how]();
  });
}

/** The phone gets a connection: the Network plugin says so, the cleanup retries. */
async function reconnect() {
  phone.connected = true;
  for (const cb of phone.onConnection) cb({ connected: true, connectionType: 'wifi' });
  await m.cleanup.runPendingCleanup();
}

beforeEach(() => {
  phone.secure.clear();
  phone.prefs.clear();
  phone.onConnection.length = 0;
  phone.connected = true;
  phone.secure.set('jaghelm-base-url', A);
  phone.secure.set('jaghelm-token', 't-old');
  phone.prefs.set('jaghelm-remember', 'true');
  phone.prefs.set('jaghelm-push-token', 'fcm-old');
  requests = [];
  down = new Set();
  answers = {};
  for (const f of Object.values(plugin)) f.mockReset().mockResolvedValue(undefined);
  plugin.addListener.mockResolvedValue({ remove: vi.fn() });
  plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
  vi.stubGlobal('fetch', vi.fn(serve));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a sign-out offline is finished when the phone is back online', () => {
  it('keeps the session it ended, the DELETE, the revoke and the token deletion', async () => {
    await startApp();
    phone.connected = false;
    await signOut();
    expect(phone.secure.has('jaghelm-token')).toBe(false); // signed out at once, as before
    expect(record()).toEqual({
      at: expect.any(Number),
      serverUrl: A,
      sessionToken: 't-old',
      pushToken: 'fcm-old',
      revoke: true,
      unregister: true,
    });
  });

  it('reconnect: the DELETE, the token deletion and the revoke are each retried once, then the record is wiped', async () => {
    await startApp();
    phone.connected = false;
    await signOut();
    requests = [];
    plugin.unregister.mockClear();

    await reconnect();
    expect(plugin.unregister).toHaveBeenCalledTimes(1);
    expect(calls('DELETE', `${A}/push/register`)).toEqual([
      { method: 'DELETE', url: `${A}/push/register`, token: 't-old', body: { token: 'fcm-old' } },
    ]);
    expect(calls('POST', `${A}/auth/logout`)).toEqual([
      { method: 'POST', url: `${A}/auth/logout`, token: 't-old', body: undefined },
    ]);
    expect(requests).toHaveLength(2);
    expect(record()).toBeNull();

    await reconnect(); // nothing left
    expect(requests).toHaveLength(2);
    expect(plugin.unregister).toHaveBeenCalledTimes(1);
  });

  it('a 401 on the retry wipes it with no further calls: that session is already gone', async () => {
    await startApp();
    phone.connected = false;
    await signOut();
    requests = [];
    plugin.unregister.mockClear();
    answers[`DELETE ${A}/push/register`] = 401;

    await reconnect();
    expect(plugin.unregister).toHaveBeenCalledTimes(1); // the phone's own step, first
    expect(calls('DELETE', `${A}/push/register`)).toHaveLength(1);
    expect(calls('POST', `${A}/auth/logout`)).toHaveLength(0);
    expect(record()).toBeNull();

    await reconnect();
    expect(requests).toHaveLength(1);
  });

  it('a server still unreachable keeps it whole and skips the revoke; a 5xx the same', async () => {
    await startApp();
    phone.connected = false;
    await signOut();
    requests = [];
    down.add(new URL(A).origin);
    await reconnect();
    expect(requests.map((r) => r.method)).toEqual(['DELETE']);
    expect(record()).toMatchObject({ pushToken: 'fcm-old', revoke: true, unregister: false });

    down.clear();
    answers[`DELETE ${A}/push/register`] = 502;
    await reconnect();
    expect(record()).toMatchObject({ pushToken: 'fcm-old', revoke: true });

    delete answers[`DELETE ${A}/push/register`];
    await reconnect();
    expect(record()).toBeNull();
  });

  it('Forget this device keeps it too, though the address is gone', async () => {
    await startApp();
    phone.connected = false;
    await signOut('forgetDevice');
    expect(phone.secure.has('jaghelm-base-url')).toBe(false);
    expect(record()).toMatchObject({ serverUrl: A, sessionToken: 't-old', revoke: true });
    requests = [];
    await reconnect();
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `DELETE ${A}/push/register`,
      `POST ${A}/auth/logout`,
    ]);
    expect(record()).toBeNull();
  });

  it('online, nothing is kept: the record goes once the answers are in', async () => {
    await startApp();
    await signOut();
    expect(calls('POST', `${A}/auth/logout`)).toHaveLength(1);
    expect(record()).toBeNull();
  });

  it('is written while the requests are still out, so closing the app then keeps it', async () => {
    await startApp();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<m.App initial={{ hasUrl: true, hasToken: true, baseUrl: A }} />);
    await act(async () => {
      m.authState.logout();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(record()).toMatchObject({ serverUrl: A, sessionToken: 't-old', pushToken: 'fcm-old', revoke: true });
  });

  it('a sign-out whose DELETE meets a 401 keeps nothing for the server: that session is over', async () => {
    await startApp();
    answers[`DELETE ${A}/push/register`] = 401;
    await signOut();
    expect(record()).toBeNull();
  });

  it('the next app start retries it before anything else; offline, it sends nothing', async () => {
    await startApp();
    phone.connected = false;
    await signOut();
    requests = [];
    plugin.unregister.mockClear();
    await startApp(); // boot, still offline
    expect(requests).toEqual([]);
    expect(plugin.unregister).not.toHaveBeenCalled();
    expect(record()).toMatchObject({ pushToken: 'fcm-old', revoke: true, unregister: true });

    phone.connected = true;
    await startApp(); // boot
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `DELETE ${A}/push/register`,
      `POST ${A}/auth/logout`,
    ]);
    expect(record()).toBeNull();
  });

  it('after 30 days it is dropped unfinished, with no calls', async () => {
    phone.secure.set(
      KEY,
      JSON.stringify({ at: Date.now() - 31 * DAY, serverUrl: A, sessionToken: 't-old', pushToken: 'fcm-old', revoke: true, unregister: true }),
    );
    await startApp();
    expect(requests).toEqual([]);
    expect(plugin.unregister).not.toHaveBeenCalled();
    expect(record()).toBeNull();
  });

  it('a record it cannot read is wiped', async () => {
    phone.secure.set(KEY, '{not json');
    await startApp();
    expect(requests).toEqual([]);
    expect(record()).toBeNull();
  });
});

describe('signing in again with a record pending', () => {
  it('runs the cleanup first, then signs in', async () => {
    await startApp();
    phone.connected = false;
    await signOut();
    requests = [];
    phone.connected = true; // no connection event: the sign-in itself waits for it

    const r = await m.login({ url: 'http://vm-101:3099', username: 'jag', password: 'pw' }); // pragma: allowlist secret
    expect(r).toEqual({ ok: true, token: 't-new' });
    expect(requests.map((q) => `${q.method} ${q.url} ${q.token ?? '-'}`)).toEqual([
      `DELETE ${A}/push/register t-old`,
      `POST ${A}/auth/logout t-old`,
      `POST ${A}/auth/login -`,
    ]);
    expect(record()).toBeNull();
  });

  it('the old token is never sent anywhere except the revoke and the DELETE for its own server', async () => {
    await startApp();
    phone.connected = false;
    await signOut('forgetDevice');

    // A new server while the old one is unreachable: sign in, register push.
    phone.connected = true;
    down.add(new URL(A).origin);
    await m.login({ url: 'http://vm-102:3099', username: 'jag', password: 'pw' }); // pragma: allowlist secret
    plugin.addListener.mockImplementation(async (event, cb) => {
      if (event === 'registration') plugin.register.mockImplementation(async () => cb({ value: 'fcm-new' }));
      return { remove: vi.fn() };
    });
    await m.push.initPush({ nav: { push: vi.fn() } });
    expect(calls('POST', `${B}/push/register`)).toEqual([
      expect.objectContaining({ token: 't-new', body: expect.objectContaining({ token: 'fcm-new' }) }),
    ]);
    expect(record()).toMatchObject({ serverUrl: A, pushToken: 'fcm-old', revoke: true, unregister: false });

    // The old server comes back.
    down.clear();
    await reconnect();
    expect(record()).toBeNull();

    const carrying = requests.filter((q) => JSON.stringify(q).includes('t-old'));
    expect(carrying.length).toBeGreaterThan(0);
    for (const q of carrying) {
      expect([`DELETE ${A}/push/register`, `POST ${A}/auth/logout`]).toContain(`${q.method} ${q.url}`);
      expect(q.token).toBe('t-old');
    }
    expect(requests.filter((q) => q.url.startsWith(B) && JSON.stringify(q).includes('t-old'))).toEqual([]);
    expect(m.client.getAuthToken()).toBe('t-new');
  });
});

describe('Turn off push leaves a record too, and a later sign-out merges into it', () => {
  it('offline Turn off push keeps the DELETE and the token deletion, not a revoke', async () => {
    await startApp();
    phone.connected = false;
    await m.push.disablePush('fcm-old');
    expect(record()).toMatchObject({ serverUrl: A, sessionToken: 't-old', pushToken: 'fcm-old', revoke: false, unregister: true });
    expect(phone.prefs.get('jaghelm-push-wanted')).toBe('false');
  });

  it('one record at most: Log out of the same session adds its revoke', async () => {
    await startApp();
    phone.connected = false;
    await m.push.disablePush('fcm-old');
    await signOut();
    expect(phone.secure.has(KEY)).toBe(true);
    expect(record()).toMatchObject({ serverUrl: A, sessionToken: 't-old', pushToken: 'fcm-old', revoke: true, unregister: true });
  });

  it("a newer session's sign-out takes the server's place; the token deletion stays", async () => {
    phone.secure.set(
      KEY,
      JSON.stringify({ at: Date.now(), serverUrl: B, sessionToken: 't-older', pushToken: '', revoke: true, unregister: true }),
    );
    phone.connected = false; // boot can't finish it
    await startApp();
    await signOut();
    expect(record()).toMatchObject({ serverUrl: A, sessionToken: 't-old', pushToken: 'fcm-old', revoke: true, unregister: true });
  });

  it('Turn on drops the push steps for this server and keeps a revoke', async () => {
    phone.secure.set(
      KEY,
      JSON.stringify({ at: Date.now(), serverUrl: A, sessionToken: 't-old', pushToken: 'fcm-old', revoke: true, unregister: true }),
    );
    phone.connected = false;
    await startApp();
    await m.cleanup.dropPushSteps(A);
    expect(record()).toMatchObject({ serverUrl: A, pushToken: '', revoke: true, unregister: false });
  });

  it('Turn on keeps a DELETE that belongs to another server', async () => {
    phone.secure.set(
      KEY,
      JSON.stringify({ at: Date.now(), serverUrl: B, sessionToken: 't-older', pushToken: 'fcm-old', revoke: false, unregister: true }),
    );
    phone.connected = false;
    await startApp();
    await m.cleanup.dropPushSteps(A);
    expect(record()).toMatchObject({ serverUrl: B, pushToken: 'fcm-old', unregister: false });
  });
});
