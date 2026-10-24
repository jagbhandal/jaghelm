/*
 * Keeping alerts alive (#653): the quiet check on every signed-in load, against a
 * fake push manager and server. A subscription that dies silently is the worst
 * failure with the Android app retired: a pruned (410) one is registered again at
 * the next load, a dropped one is subscribed again without a prompt, a revoked
 * permission says "Alerts on this phone stopped". Never a prompt on its own, never
 * an endpoint on the page.
 */
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import AlertsStopped from './ui/alerts-stopped.jsx';
import { SYNC_EVERY_MS, syncWebPush, turnAlertsBackOn } from './webPushSync.js';
import {
  ALERTS_FLAG,
  ALERTS_SYNCED,
  alertsWereOn,
  keyBytes,
  subscriptionIdOf,
} from './components/settings/sections/webPushData.js';
import { setAuthToken, setReadOnlyServer } from './api/client.js';

const SERVER_KEY = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'; // pragma: allowlist secret
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/SYNC-SECRET-ENDPOINT';
const P256DH = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'; // pragma: allowlist secret
const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg'; // pragma: allowlist secret

let browser;
let server; // { listed: string[], posts: object[], keyOk }
function fakeBrowser({ permission = 'granted', held = true, request = 'granted' } = {}) {
  const make = () => ({
    endpoint: ENDPOINT,
    options: { applicationServerKey: keyBytes(SERVER_KEY).buffer },
    toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } }),
    unsubscribe: vi.fn(async () => {
      browser.sub = null;
      return true;
    }),
  });
  browser = { permission, sub: held ? make() : null, subscribes: 0, prompts: 0 };
  const pushManager = {
    getSubscription: vi.fn(async () => browser.sub),
    subscribe: vi.fn(async () => {
      browser.subscribes += 1;
      browser.sub = make();
      return browser.sub;
    }),
  };
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  window.PushManager = function PushManager() {};
  vi.stubGlobal('Notification', {
    get permission() {
      return browser.permission;
    },
    requestPermission: vi.fn(async () => {
      browser.prompts += 1;
      browser.permission = request;
      return request;
    }),
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
}

beforeEach(() => {
  localStorage.clear();
  setAuthToken('');
  server = { listed: [], posts: [], enabled: true };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts = {}) => {
      const path = String(url).split('?')[0];
      const method = opts.method ?? 'GET';
      if (path === '/api/push/web/key') return Response.json({ enabled: server.enabled, publicKey: SERVER_KEY });
      if (path === '/api/push/web/subscriptions' && method === 'GET')
        return Response.json({ enabled: true, subscriptions: server.listed.map((id) => ({ id })) });
      if (path === '/api/push/web/subscriptions' && method === 'POST') {
        const body = JSON.parse(opts.body);
        server.posts.push(body);
        server.listed = [await subscriptionIdOf(body.subscription.endpoint)];
        return Response.json({ id: server.listed[0], created: true }, { status: 201 });
      }
      if (path === '/api/auth/check') return Response.json({ authRequired: false, authenticated: true });
      return Response.json({}, { status: 200 });
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete navigator.serviceWorker;
  setReadOnlyServer(false);
});

describe('syncWebPush', () => {
  it('registers a subscription the server no longer lists (a 410 pruned it) at the next load, with no prompt', async () => {
    fakeBrowser();
    localStorage.setItem(ALERTS_FLAG, '1');
    expect(server.listed).toEqual([]); // pruned
    await expect(syncWebPush()).resolves.toBe('healed');
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0].subscription.endpoint).toBe(ENDPOINT);
    expect(server.listed).toEqual([await subscriptionIdOf(ENDPOINT)]);
    expect(browser.prompts).toBe(0);
  });

  it('does nothing more than a check when the server lists it and it was synced today; sends again after a day', async () => {
    fakeBrowser();
    localStorage.setItem(ALERTS_FLAG, '1');
    server.listed = [await subscriptionIdOf(ENDPOINT)];
    const t = 1_800_000_000_000;
    localStorage.setItem(ALERTS_SYNCED, String(t));
    await expect(syncWebPush({ now: () => t + 1000 })).resolves.toBe('ok');
    expect(server.posts).toHaveLength(0);
    await expect(syncWebPush({ now: () => t + SYNC_EVERY_MS + 1 })).resolves.toBe('ok');
    expect(server.posts).toHaveLength(1); // refreshed, keeping "last seen" young
  });

  it('subscribes again, without a prompt, when alerts were on, the permission stands and the browser lost the subscription', async () => {
    fakeBrowser({ held: false });
    localStorage.setItem(ALERTS_FLAG, '1');
    await expect(syncWebPush()).resolves.toBe('healed');
    expect(browser.subscribes).toBe(1);
    expect(browser.prompts).toBe(0);
    expect(server.posts).toHaveLength(1);
  });

  it('replaces a subscription made for another server key', async () => {
    fakeBrowser();
    browser.sub.options.applicationServerKey = keyBytes(`B${SERVER_KEY.slice(1, -2)}AA`).buffer;
    await expect(syncWebPush()).resolves.toBe('healed');
    expect(browser.subscribes).toBe(1);
  });

  it('is quiet when alerts were never on here: no subscription, no flag, nothing asked', async () => {
    fakeBrowser({ held: false });
    await expect(syncWebPush()).resolves.toBe('off');
    expect(browser.prompts).toBe(0);
    expect(server.posts).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says stopped when alerts were on and the permission was taken back; never asks itself', async () => {
    for (const permission of ['denied', 'default']) {
      fakeBrowser({ permission });
      localStorage.setItem(ALERTS_FLAG, '1');
      await expect(syncWebPush()).resolves.toBe('stopped');
      expect(browser.prompts).toBe(0);
    }
    fakeBrowser({ permission: 'denied' });
    localStorage.clear();
    await expect(syncWebPush()).resolves.toBe('off');
  });

  it('says stopped when the browser refuses a new subscription; nothing when the server is simply unreachable', async () => {
    fakeBrowser({ held: false });
    localStorage.setItem(ALERTS_FLAG, '1');
    const pm = (await navigator.serviceWorker.ready).pushManager;
    pm.subscribe = vi.fn(async () => {
      throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
    });
    await expect(syncWebPush()).resolves.toBe('stopped');
    fakeBrowser();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(syncWebPush()).resolves.toBe('ok');
  });

  it('says stopped when alerts were on and the server has turned Web Push off', async () => {
    fakeBrowser();
    localStorage.setItem(ALERTS_FLAG, '1');
    server.enabled = false;
    await expect(syncWebPush()).resolves.toBe('stopped');
  });

  it('does nothing in the read-only demo', async () => {
    fakeBrowser();
    localStorage.setItem(ALERTS_FLAG, '1');
    setReadOnlyServer(true);
    await expect(syncWebPush()).resolves.toBe('off');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the flag after a good sync, and the endpoint is in no storage', async () => {
    fakeBrowser();
    await syncWebPush();
    expect(alertsWereOn()).toBe(true);
    expect(JSON.stringify({ ...localStorage })).not.toContain('SYNC-SECRET');
  });
});

describe('turnAlertsBackOn', () => {
  it('prompts only here, from the click, when the permission is undecided, then subscribes', async () => {
    fakeBrowser({ permission: 'default', held: false });
    localStorage.setItem(ALERTS_FLAG, '1');
    await expect(turnAlertsBackOn()).resolves.toBe('healed');
    expect(browser.prompts).toBe(1);
    expect(server.posts).toHaveLength(1);
  });
  it('says stopped when the browser blocks it, so the app sends the person to Settings', async () => {
    fakeBrowser({ permission: 'denied' });
    await expect(turnAlertsBackOn()).resolves.toBe('stopped');
    fakeBrowser({ permission: 'default', request: 'denied' });
    await expect(turnAlertsBackOn()).resolves.toBe('stopped');
  });
});

describe('the notice', () => {
  it('says what stopped, once, as an alert, with the one button', async () => {
    const user = userEvent.setup();
    const onTurnOn = vi.fn();
    render(<AlertsStopped onTurnOn={onTurnOn} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Alerts on this phone stopped');
    await user.click(screen.getByRole('button', { name: 'Turn them back on' }));
    expect(onTurnOn).toHaveBeenCalledTimes(1);
  });
});

describe('the app', () => {
  it('shows the notice on any page when alerts were on and the permission is gone; Turn them back on mends it from the click', async () => {
    fakeBrowser({ permission: 'default', held: false, request: 'granted' });
    localStorage.setItem(ALERTS_FLAG, '1');
    render(<App />);
    expect(await screen.findByText('Alerts on this phone stopped')).toBeInTheDocument();
    expect(browser.prompts).toBe(0); // loading asks for nothing
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Turn them back on' }));
    await waitFor(() => expect(screen.queryByText('Alerts on this phone stopped')).toBeNull());
    expect(browser.prompts).toBe(1);
    expect(server.posts).toHaveLength(1);
  });

  it('mends a pruned subscription at load without any notice', async () => {
    fakeBrowser();
    localStorage.setItem(ALERTS_FLAG, '1');
    render(<App />);
    await waitFor(() => expect(server.posts).toHaveLength(1));
    await act(async () => {});
    expect(screen.queryByText('Alerts on this phone stopped')).toBeNull();
  });

  it('shows no notice, and asks nothing, for a phone that never turned alerts on', async () => {
    fakeBrowser({ held: false, permission: 'default' });
    render(<App />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText('Alerts on this phone stopped')).toBeNull();
    expect(browser.prompts).toBe(0);
  });
});
