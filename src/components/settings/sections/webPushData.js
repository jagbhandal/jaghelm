/**
 * Settings → Notifications' "Alerts on this device" (#653): this browser's Web
 * Push subscription, and the server's side of it (GET /api/push/web/key and
 * /subscriptions, POST /subscriptions, DELETE /subscriptions/:id).
 *
 * The state is read from three places and named once (stateOf):
 *   support     what this browser and page can do at all (supportOf)
 *   server      whether the server has VAPID keys, and its public key
 *   browser     the permission, and the subscription the push manager holds
 *   registered  whether the server lists that subscription
 *
 * The permission prompt appears on a click (enable), never on load. The
 * subscription's endpoint and keys go to the server in the registration and
 * nowhere else: no state, log line or message here carries them; the page
 * tells its own subscription from the server's list by an id both compute
 * (the first 12 hex characters of the SHA-256 of the endpoint).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, isReadOnlyServer } from '../../../api/client.js';

export const KEY_URL = '/api/push/web/key';
export const SUBSCRIPTIONS_URL = '/api/push/web/subscriptions';

/** How long to wait for the service worker before saying it isn't running. */
export const WORKER_TIMEOUT_MS = 5000;

/**
 * What this page can do, from the browser it runs in. Pure.
 *   unsupported  no service worker, push manager or notifications
 *   insecure     not https (a page on plain http has no push)
 *   install      iPhone or iPad outside an installed app: Safari only pushes
 *                to a web app added to the Home Screen (iOS 16.4+)
 *   ok
 *
 * @param {{ secure?: boolean, serviceWorker?: boolean, pushManager?: boolean, notification?: boolean, userAgent?: string, standalone?: boolean, maxTouchPoints?: number }} env
 */
export function supportOf({
  secure = false,
  serviceWorker = false,
  pushManager = false,
  notification = false,
  userAgent = '',
  standalone = false,
  maxTouchPoints = 0,
} = {}) {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!secure) return 'insecure';
  if (ios && !standalone) return 'install';
  if (!serviceWorker || !pushManager || !notification) return 'unsupported';
  return 'ok';
}

/** supportOf for the window this runs in. */
export function browserSupport() {
  if (typeof window === 'undefined') return 'unsupported';
  return supportOf({
    secure: window.isSecureContext === true,
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
    userAgent: navigator.userAgent,
    standalone:
      navigator.standalone === true ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches),
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

/** A name for this browser in the device list: "Pixel 8 (Chrome)", "Firefox on Linux". Pure. */
export function deviceNameOf(userAgent = '') {
  const ua = String(userAgent);
  const browser = /Edg(?:e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser\//.test(ua)
      ? 'Samsung Internet'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /OPR\//.test(ua)
          ? 'Opera'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Browser';
  const model = /Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?\s*[;)]/.exec(ua)?.[1]?.trim();
  if (model && model !== 'K' && model.length <= 40) return `${model} (${browser})`;
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /iPad/.test(ua)
        ? 'iPad'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : '';
  return os ? `${browser} on ${os}` : browser;
}

/** The server's public key as the bytes pushManager.subscribe wants. @param {string} key */
export function keyBytes(key) {
  const bin = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** An ArrayBuffer as unpadded base64url. @param {ArrayBuffer | null | undefined} buf */
function base64url(buf) {
  if (!buf) return '';
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The id the server gives a subscription: the first 12 hex characters of the
 * SHA-256 of its endpoint (server/push/webPushStore.js subscriptionId).
 * @param {string} endpoint
 */
export async function subscriptionIdOf(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}

/**
 * The one state the panel shows. Pure.
 *
 *   loading      still reading
 *   unsupported | insecure | install   (supportOf)
 *   server-off   the server has no (usable) VAPID keys: `reason` says which
 *   denied       the browser blocks notifications for this site
 *   off          nothing subscribed here: Enable
 *   on           subscribed here and the server lists it
 *   expired      the browser holds a subscription the server doesn't list, or
 *                one made for another server key: turn on again
 *
 * @param {{ loading: boolean, support: string, server: { enabled: boolean, reason?: string } | null, permission: string, subscribed: boolean, registered: boolean, keyMatches: boolean }} read
 */
export function stateOf({ loading, support, server, permission, subscribed, registered, keyMatches }) {
  if (loading) return 'loading';
  if (support !== 'ok') return support;
  if (!server?.enabled) return 'server-off';
  if (permission === 'denied') return 'denied';
  if (!subscribed || permission !== 'granted') return 'off';
  return registered && keyMatches ? 'on' : 'expired';
}

/** The server's words for a refusal, else a sentence. */
async function reasonOf(r, what) {
  const body = await r.json().catch(() => null);
  return typeof body?.error === 'string' ? body.error : `${what} (HTTP ${r.status})`;
}

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

/**
 * This device's alerts: `{ state, reason, id, name, busy, notice, readOnly,
 * enable(), disable(), reload() }`. `id` is this browser's subscription id
 * when it holds one, for the device list's row and the test push.
 */
export function useWebPush() {
  const [read, setRead] = useState({
    loading: true,
    support: browserSupport(),
    server: null,
    permission: typeof Notification === 'undefined' ? 'default' : Notification.permission,
    subscribed: false,
    registered: false,
    keyMatches: true,
    id: null,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const alive = useRef(true);
  const readOnly = isReadOnlyServer();

  const reload = useCallback(async () => {
    const support = browserSupport();
    let server = null;
    try {
      const r = await apiFetch(KEY_URL, { cache: 'no-store' });
      if (r.ok) server = await r.json();
    } catch {
      // unreachable: "the server isn't answering", below
    }
    let subscribed = false;
    let registered = false;
    let keyMatches = true;
    let id = null;
    const permission = support === 'ok' || support === 'unsupported' ? currentPermission() : 'default';
    if (support === 'ok' && server?.enabled && permission === 'granted') {
      try {
        const reg = await withTimeout(navigator.serviceWorker.ready, WORKER_TIMEOUT_MS);
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          subscribed = true;
          id = await subscriptionIdOf(sub.endpoint);
          keyMatches = !sub.options?.applicationServerKey || base64url(sub.options.applicationServerKey) === server.publicKey;
          const list = await apiFetch(SUBSCRIPTIONS_URL, { cache: 'no-store' });
          registered = list.ok && ((await list.json()).subscriptions ?? []).some((s) => s.id === id);
        }
      } catch {
        // no service worker yet: shown as off; Enable says what to do
      }
    }
    if (alive.current) {
      setRead({ loading: false, support, server: server ?? { enabled: false, reason: 'unreachable' }, permission, subscribed, registered, keyMatches, id });
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  const enable = useCallback(async () => {
    if (readOnly || !read.server?.enabled) return;
    setNotice(null);
    setBusy(true);
    let created = null;
    try {
      // The prompt, on this click.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setNotice({
          tone: permission === 'denied' ? 'error' : 'info',
          text:
            permission === 'denied'
              ? 'The browser blocked notifications for JagHelm.'
              : 'Notifications were not allowed, so alerts are still off.',
        });
        return;
      }
      let reg;
      try {
        reg = await withTimeout(navigator.serviceWorker.ready, WORKER_TIMEOUT_MS);
      } catch {
        setNotice({ tone: 'error', text: "JagHelm's background worker isn't running yet. Reload the page and try again." });
        return;
      }
      let sub = await reg.pushManager.getSubscription();
      if (sub && sub.options?.applicationServerKey && base64url(sub.options.applicationServerKey) !== read.server.publicKey) {
        await sub.unsubscribe(); // made for another server key
        sub = null;
      }
      if (!sub) {
        sub = created = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(read.server.publicKey),
        });
      }
      const r = await apiFetch(SUBSCRIPTIONS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), name: deviceNameOf(navigator.userAgent) }),
      });
      if (!r.ok) {
        if (created) await created.unsubscribe().catch(() => {});
        setNotice({ tone: 'error', text: await reasonOf(r, "Couldn't turn alerts on") });
        return;
      }
    } catch (err) {
      if (created) await created.unsubscribe().catch(() => {});
      // The browser's own words (a push service it can't reach) name no URL.
      const name = err?.name === 'NotAllowedError' ? 'The browser did not allow it.' : "Couldn't reach the browser's push service.";
      setNotice({ tone: 'error', text: `Couldn't turn alerts on. ${name}` });
    } finally {
      setBusy(false);
    }
    await reload();
  }, [read.server, readOnly, reload]);

  const disable = useCallback(async () => {
    if (readOnly) return;
    setNotice(null);
    setBusy(true);
    try {
      const reg = await withTimeout(navigator.serviceWorker.ready, WORKER_TIMEOUT_MS);
      const sub = await reg.pushManager.getSubscription();
      const id = sub ? await subscriptionIdOf(sub.endpoint) : read.id;
      if (sub) await sub.unsubscribe();
      if (id) {
        const r = await apiFetch(`${SUBSCRIPTIONS_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!r.ok && r.status !== 404) setNotice({ tone: 'error', text: await reasonOf(r, "Couldn't remove it from the server") });
      }
    } catch {
      setNotice({ tone: 'error', text: "Couldn't turn alerts off in this browser. Reload the page and try again." });
    } finally {
      setBusy(false);
    }
    await reload();
  }, [read.id, readOnly, reload]);

  const state = stateOf(read);
  return {
    state,
    reason: read.server?.reason ?? null,
    id: read.id,
    name: deviceNameOf(typeof navigator === 'undefined' ? '' : navigator.userAgent),
    busy,
    notice,
    readOnly,
    enable,
    disable,
    reload,
  };
}

function currentPermission() {
  return typeof Notification === 'undefined' ? 'default' : Notification.permission;
}
