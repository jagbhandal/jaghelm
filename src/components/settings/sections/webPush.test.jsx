/*
 * Settings → Notifications → Alerts on this device (#653): what this browser
 * and page can do (supportOf), the one state the panel shows (stateOf) and the
 * flows behind its buttons against a fake push manager and server: the
 * permission prompt only on a click, subscribing with the server's key,
 * registering, the test alert, turning off, the states for a blocked, an
 * unsupported, an uninstalled and an expired device, and Web Push off on the
 * server. The endpoint and keys are checked never to reach the page.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Notifications from './Notifications.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';
import {
  deviceNameOf,
  keyBytes,
  stateOf,
  subscriptionIdOf,
  supportOf,
} from './webPushData.js';
import { WebPushDevice } from '@ui/web-push';
import { OverlayProvider } from '../../../context/OverlayContext.jsx';
import { setReadOnlyServer } from '../../../api/client.js';

const SERVER_KEY = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'; // pragma: allowlist secret
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/PAGE-SECRET-ENDPOINT';
const P256DH = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'; // pragma: allowlist secret
const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg'; // pragma: allowlist secret

describe('supportOf', () => {
  const good = { secure: true, serviceWorker: true, pushManager: true, notification: true, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) Chrome/130' };
  it('is ok where everything is there', () => expect(supportOf(good)).toBe('ok'));
  it('needs https first', () => expect(supportOf({ ...good, secure: false })).toBe('insecure'));
  it('says unsupported without a push manager, a worker or notifications', () => {
    for (const k of ['serviceWorker', 'pushManager', 'notification']) expect(supportOf({ ...good, [k]: false })).toBe('unsupported');
  });
  it('asks iPhone and iPad (and iPadOS posing as a Mac) outside an installed app to add it to the Home Screen', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/605.1.15';
    expect(supportOf({ ...good, userAgent: iphone, pushManager: false })).toBe('install');
    expect(supportOf({ ...good, userAgent: iphone, standalone: true })).toBe('ok');
    expect(supportOf({ ...good, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', maxTouchPoints: 5, pushManager: false })).toBe('install');
    expect(supportOf({ ...good, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', maxTouchPoints: 0 })).toBe('ok');
  });
});

describe('stateOf', () => {
  const read = { loading: false, support: 'ok', server: { enabled: true }, permission: 'granted', subscribed: true, registered: true, keyMatches: true };
  it('names one state from what was read', () => {
    expect(stateOf({ ...read, loading: true })).toBe('loading');
    expect(stateOf({ ...read, support: 'install' })).toBe('install');
    expect(stateOf({ ...read, server: { enabled: false, reason: 'unset' } })).toBe('server-off');
    expect(stateOf({ ...read, permission: 'denied' })).toBe('denied');
    expect(stateOf({ ...read, permission: 'default', subscribed: false })).toBe('off');
    expect(stateOf({ ...read, subscribed: false })).toBe('off');
    expect(stateOf(read)).toBe('on');
    expect(stateOf({ ...read, registered: false })).toBe('expired');
    expect(stateOf({ ...read, keyMatches: false })).toBe('expired');
  });
});

describe('helpers', () => {
  it('names a device from its user agent', () => {
    expect(deviceNameOf('Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A) AppleWebKit Chrome/130 Mobile Safari/537')).toBe('Pixel 8 (Chrome)');
    expect(deviceNameOf('Mozilla/5.0 (Linux; Android 10; K) Chrome/130 Mobile Safari/537')).toBe('Chrome on Android');
    expect(deviceNameOf('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox on Linux');
    expect(deviceNameOf('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537 Edg/130')).toBe('Edge on Windows');
    expect(deviceNameOf('')).toBe('Browser');
  });
  it('turns the server key into bytes, a 65 byte point', () => {
    const bytes = keyBytes(SERVER_KEY);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });
  it('computes the id the server computes: 12 hex of the endpoint’s SHA-256', async () => {
    const id = await subscriptionIdOf('https://fcm.googleapis.com/fcm/send/abc');
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(id).toBe(await subscriptionIdOf('https://fcm.googleapis.com/fcm/send/abc'));
    expect(id).not.toBe(await subscriptionIdOf('https://fcm.googleapis.com/fcm/send/abd'));
  });
});

// ── the panel, state by state ────────────────────────────────────────────────

describe('WebPushDevice', () => {
  const words = {
    unsupported: /can’t receive alerts/,
    insecure: /secure address/,
    install: /Add to Home Screen/,
    denied: /Notifications are blocked/,
    off: /Alerts are off on this device/,
    expired: /need turning on again/,
    'server-off': /Web Push is off on this server/,
    loading: /Checking this device/,
    on: /Alerts are off|Listed below/,
  };
  it('says each state in words', () => {
    for (const [state, re] of Object.entries(words)) {
      const { unmount } = render(<WebPushDevice state={state} reason="unset" name="Pixel 8 (Chrome)" />);
      expect(screen.getByText(re)).toBeInTheDocument();
      unmount();
    }
  });
  it('tells the exact fix when the server has no keys, for each reason', () => {
    for (const [reason, re] of [['unset', /no Web Push keys/], ['incomplete', /Only some/], ['invalid', /not a valid key pair/], ['unreachable', /did not answer/]]) {
      const { unmount } = render(<WebPushDevice state="server-off" reason={reason} />);
      const p = screen.getByText(re).closest('div');
      expect(p).toHaveTextContent('node scripts/vapid-keys.mjs');
      expect(p).toHaveTextContent('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT');
      unmount();
    }
  });
  it('shows Enable when off, Turn on again when expired, Send test and Turn off when on, and nothing to press otherwise', () => {
    const calls = [];
    const props = { onEnable: () => calls.push('enable'), onDisable: () => calls.push('disable'), onTest: () => calls.push('test') };
    const { rerender } = render(<WebPushDevice state="off" {...props} />);
    expect(screen.getByRole('button', { name: 'Enable alerts on this device' })).toBeInTheDocument();
    rerender(<WebPushDevice state="expired" {...props} />);
    expect(screen.getByRole('button', { name: 'Turn on again' })).toBeInTheDocument();
    rerender(<WebPushDevice state="on" {...props} />);
    expect(screen.getByRole('button', { name: 'Send test alert' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
    for (const state of ['denied', 'unsupported', 'insecure', 'install', 'server-off', 'loading']) {
      rerender(<WebPushDevice state={state} {...props} />);
      expect(screen.queryByRole('button')).toBeNull();
    }
  });
  it('shows the test outcome and a refusal, waits its buttons while busy, and sends nothing in the read-only demo', () => {
    const { rerender } = render(<WebPushDevice state="on" busy test="Delivered." notice={{ tone: 'error', text: 'It failed.' }} />);
    expect(screen.getByRole('button', { name: 'Send test alert' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Test alert: Delivered.');
    expect(screen.getByRole('alert')).toHaveTextContent('It failed.');
    rerender(<WebPushDevice state="off" readOnly />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/read-only demo/)).toBeInTheDocument();
  });
});

// ── the flow, against a fake browser and server ───────────────────────────────

function fakeBrowser({ permission = 'default', request = 'granted', existing = null } = {}) {
  const sub = (key = keyBytes(SERVER_KEY).buffer) => ({
    endpoint: ENDPOINT,
    options: { applicationServerKey: key },
    toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } }),
    unsubscribe: vi.fn(async () => {
      state.sub = null;
      return true;
    }),
  });
  const state = { sub: existing ? sub(existing.key) : null, permission, subscribeCalls: [] };
  const pushManager = {
    getSubscription: vi.fn(async () => state.sub),
    subscribe: vi.fn(async (options) => {
      state.subscribeCalls.push(options);
      state.sub = sub();
      return state.sub;
    }),
  };
  const requestPermission = vi.fn(async () => {
    state.permission = request;
    return request;
  });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  vi.stubGlobal('PushManager', function PushManager() {});
  window.PushManager = globalThis.PushManager;
  vi.stubGlobal('Notification', {
    get permission() {
      return state.permission;
    },
    requestPermission,
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A) AppleWebKit/537 Chrome/130 Mobile Safari/537',
  });
  return { state, pushManager, requestPermission };
}

let calls;
let answers;
let registered; // the subscription ids the server lists
const DEVICES = (extra = []) => ({
  enabled: true,
  channels: { web: true },
  stalled: null,
  defaults: { enabled: true, notifyRecoveries: true, categories: { service: true, host: true, ups: true, cron: true, watchtower: true } },
  devices: extra,
  test: null,
  cooldownS: 30,
});

beforeEach(() => {
  calls = [];
  registered = [];
  answers = {
    'GET /api/thresholds': () => Response.json({ thresholds: [] }, { headers: { ETag: '"v1"' } }),
    'GET /api/push/devices': () => Response.json(DEVICES()),
    'GET /api/push/alerts': () => Response.json({ held: 0, snoozed: [], acked: [] }),
    'GET /api/push/web/key': () => Response.json({ enabled: true, publicKey: SERVER_KEY }),
    'GET /api/push/web/subscriptions': () =>
      Response.json({ enabled: true, subscriptions: registered.map((id) => ({ id, name: 'x', createdAt: 'x', lastSeen: 'x' })) }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts = {}) => {
      const method = opts.method ?? 'GET';
      calls.push({ method, url, body: opts.body ? JSON.parse(opts.body) : undefined });
      const answer = answers[`${method} ${String(url).split('?')[0]}`] ?? (String(url).startsWith('/api/push/web/subscriptions/') && method === 'DELETE' ? () => Response.json({ removed: true }) : null);
      return answer ? answer(opts) : Response.json({ error: 'no answer' }, { status: 500 });
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  setReadOnlyServer(false);
  delete navigator.serviceWorker;
});

const renderSection = () =>
  render(
    <ConfigProvider config={{}} setConfig={() => {}}>
      <OverlayProvider>
        <Notifications />
      </OverlayProvider>
    </ConfigProvider>
  );
const panel = () => screen.getByRole('region', { name: 'Alerts on this device' });

describe('Alerts on this device', () => {
  it('asks no permission on load: the prompt waits for the click', async () => {
    const b = fakeBrowser();
    renderSection();
    expect(await within(await screen.findByRole('region', { name: 'Alerts on this device' })).findByRole('button', { name: 'Enable alerts on this device' })).toBeInTheDocument();
    expect(b.requestPermission).not.toHaveBeenCalled();
    expect(b.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('Enable asks permission, subscribes with the server’s key, registers it with a name, and shows the device on', async () => {
    const user = userEvent.setup();
    const b = fakeBrowser();
    renderSection();
    const enable = await screen.findByRole('button', { name: 'Enable alerts on this device' });
    answers['POST /api/push/web/subscriptions'] = async () => {
      registered.push(await subscriptionIdOf(ENDPOINT));
      return Response.json({ id: registered[0], name: 'Pixel 8 (Chrome)', created: true }, { status: 201 });
    };
    await user.click(enable);
    await waitFor(() => expect(within(panel()).getByRole('button', { name: 'Send test alert' })).toBeInTheDocument());
    expect(b.requestPermission).toHaveBeenCalledTimes(1);
    expect(b.state.subscribeCalls).toHaveLength(1);
    expect(b.state.subscribeCalls[0].userVisibleOnly).toBe(true);
    expect([...b.state.subscribeCalls[0].applicationServerKey]).toEqual([...keyBytes(SERVER_KEY)]);
    const post = calls.find((c) => c.method === 'POST');
    expect(post.body.subscription.endpoint).toBe(ENDPOINT);
    expect(post.body.name).toBe('Pixel 8 (Chrome)');
    // the page never draws the endpoint or the keys
    expect(document.body.textContent).not.toContain('PAGE-SECRET-ENDPOINT');
    expect(document.body.textContent).not.toContain(P256DH);
    expect(document.body.textContent).not.toContain(AUTH);
  });

  it('a blocked permission is said, with how to allow it, and nothing is subscribed', async () => {
    const user = userEvent.setup();
    const b = fakeBrowser({ request: 'denied' });
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Enable alerts on this device' }));
    expect(await within(panel()).findByText('The browser blocked notifications for JagHelm.')).toBeInTheDocument();
    expect(b.pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows the blocked state, with the way back, when the browser already blocks the site', async () => {
    fakeBrowser({ permission: 'denied' });
    renderSection();
    expect(await screen.findByText('Notifications are blocked for JagHelm')).toBeInTheDocument();
    expect(screen.getByText(/set Notifications to Allow/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable alerts on this device' })).toBeNull();
  });

  it('a registration the server refuses is said, and the new subscription is undone', async () => {
    const user = userEvent.setup();
    const b = fakeBrowser();
    renderSection();
    answers['POST /api/push/web/subscriptions'] = () =>
      Response.json({ error: "This browser's push service is not one JagHelm sends to (Chrome, Edge, Firefox and Safari are)" }, { status: 400 });
    await user.click(await screen.findByRole('button', { name: 'Enable alerts on this device' }));
    expect(await within(panel()).findByRole('alert')).toHaveTextContent("push service is not one JagHelm sends to");
    await waitFor(() => expect(b.state.sub).toBeNull());
  });

  it('Send test alert uses the device list’s test push for this device, and says how it went', async () => {
    const user = userEvent.setup();
    const id = await subscriptionIdOf(ENDPOINT);
    registered.push(id);
    fakeBrowser({ permission: 'granted', existing: { key: keyBytes(SERVER_KEY).buffer } });
    answers['POST /api/push/test'] = () =>
      Response.json({ at: '2026-10-24T10:00:00.000Z', device: id, historyId: 'h', done: true, sentence: 'Delivered', results: [{ device: id, state: 'sent', sentence: "Delivered: the browser's push service accepted it. It shows unless JagHelm is open on screen." }] }, { status: 202 });
    renderSection();
    await user.click(await within(await screen.findByRole('region', { name: 'Alerts on this device' })).findByRole('button', { name: 'Send test alert' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/push/test')?.body).toEqual({ device: id }));
    expect(await within(panel()).findByText(/push service accepted it/)).toBeInTheDocument();
  });

  it('Turn off unsubscribes this browser and removes it from the server', async () => {
    const user = userEvent.setup();
    const id = await subscriptionIdOf(ENDPOINT);
    registered.push(id);
    const b = fakeBrowser({ permission: 'granted', existing: { key: keyBytes(SERVER_KEY).buffer } });
    renderSection();
    await user.click(await within(await screen.findByRole('region', { name: 'Alerts on this device' })).findByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === `/api/push/web/subscriptions/${id}`)).toBe(true));
    expect(b.state.sub).toBeNull();
    expect(await within(panel()).findByRole('button', { name: 'Enable alerts on this device' })).toBeInTheDocument();
  });

  it('a subscription the server no longer lists is “expired”: turn on again', async () => {
    fakeBrowser({ permission: 'granted', existing: { key: keyBytes(SERVER_KEY).buffer } });
    renderSection();
    expect(await screen.findByText('This device’s alerts need turning on again')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on again' })).toBeInTheDocument();
  });

  it('a subscription made for another server key is “expired” too, and Turn on again replaces it', async () => {
    const user = userEvent.setup();
    const other = keyBytes(`B${SERVER_KEY.slice(1, -2)}AA`).buffer;
    const b = fakeBrowser({ permission: 'granted', existing: { key: other } });
    registered.push(await subscriptionIdOf(ENDPOINT));
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Turn on again' }));
    await waitFor(() => expect(b.pushManager.subscribe).toHaveBeenCalledTimes(1));
  });

  it('says Web Push is off on the server, with the fix, when the keys are missing', async () => {
    fakeBrowser();
    answers['GET /api/push/web/key'] = () => Response.json({ enabled: false, reason: 'unset' });
    renderSection();
    expect(await screen.findByText('Web Push is off on this server')).toBeInTheDocument();
    expect(screen.getByText(/node scripts\/vapid-keys\.mjs/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable alerts on this device' })).toBeNull();
  });

  it('says so when the browser has no push, the page is not https, or iOS has not installed it', async () => {
    fakeBrowser();
    delete window.PushManager;
    vi.stubGlobal('PushManager', undefined);
    delete globalThis.PushManager;
    const { unmount } = renderSection();
    expect(await screen.findByText('This browser can’t receive alerts')).toBeInTheDocument();
    unmount();
    fakeBrowser();
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    renderSection();
    expect(await screen.findByText('Alerts need a secure address')).toBeInTheDocument();
  });

  it('lists a browser in the device list as a browser, not a phone', async () => {
    fakeBrowser();
    answers['GET /api/push/devices'] = () =>
      Response.json(
        DEVICES([{ id: 'aaaaaaaaaaaa', name: 'Pixel 8 (Chrome)', platform: 'web', registeredAt: '2026-10-24T08:00:00.000Z', lastSeenAt: '2026-10-24T09:00:00.000Z', lastDeliveredAt: null, lastError: null, prefs: { enabled: true, notifyRecoveries: true, categories: { service: true, host: true, ups: true, cron: true, watchtower: true } } }])
      );
    renderSection();
    expect(await screen.findByRole('heading', { name: 'Pixel 8 (Chrome)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Pixel 8 (Chrome)' })).toBeInTheDocument();
  });

  it('in the read-only demo, shows the state and offers nothing to press', async () => {
    fakeBrowser();
    setReadOnlyServer(true);
    renderSection();
    expect(await screen.findByText('Alerts are off on this device')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable alerts on this device' })).toBeNull();
  });
});
