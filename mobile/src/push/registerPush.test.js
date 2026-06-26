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
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }));

// @capacitor/app App.addListener('appUrlOpen', ...) — the custom-scheme path B.
const appPlugin = vi.hoisted(() => ({ addListener: vi.fn() }));
vi.mock('@capacitor/app', () => ({ App: appPlugin }));

// ALL mock fns referenced inside a vi.mock factory use vi.hoisted() — vi.mock is
// hoisted above the file's top, so a plain `const` referenced in the factory
// would sit in its temporal dead zone (the TDZ trap). vi.hoisted() lifts the fn
// to the same level as the mock, eliminating the risk uniformly.
const { setPref } = vi.hoisted(() => ({ setPref: vi.fn() }));
vi.mock('../storage/prefsAdapter.js', () => ({ setPref, getPref: vi.fn() }));

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

import { initPush } from './registerPush.js';

beforeEach(() => {
  for (const f of Object.values(plugin)) f.mockReset();
  appPlugin.addListener.mockReset().mockResolvedValue({ remove: vi.fn() });
  routeFromData.mockReset();
  routeFromUrl.mockReset();
  setPref.mockReset().mockResolvedValue(undefined);
  registerToken.mockReset().mockResolvedValue({ stored: true, deliveryEnabled: true });
  deleteToken.mockReset().mockResolvedValue({ removed: true });
  plugin.addListener.mockResolvedValue({ remove: vi.fn() });
  plugin.register.mockResolvedValue(undefined);
  plugin.createChannel.mockResolvedValue(undefined);
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
