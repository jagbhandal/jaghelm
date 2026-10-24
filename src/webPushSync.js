/**
 * Keeping this device's Web Push alive (#653). A subscription can die without a
 * word: the server prunes it (a 410, or 180 days unseen), the browser replaces
 * it, the user takes the permission back. With the Android app retired, that is
 * the worst failure, so every signed-in load of the app (loaded on its own, a
 * lazy chunk: App.jsx) checks and mends it quietly:
 *
 *  - permission granted and a subscription held: it is registered again when the
 *    server doesn't list it (healed a prune at once), or when the last sync was
 *    over a day ago (so "last seen" stays fresh); the register route is
 *    idempotent per endpoint;
 *  - permission granted, alerts were on here (a flag, never an endpoint) and the
 *    browser holds none: it subscribes again, which needs no prompt;
 *  - permission gone, or it cannot be mended: 'stopped', and App shows the
 *    "Alerts stopped" notice with one button.
 *
 * It never asks for permission on its own (only turnAlertsBackOn, from a click),
 * never shows or logs an endpoint, and a server it cannot reach is no verdict.
 *
 * Returns 'off' (nothing to keep alive), 'ok', 'healed' or 'stopped'.
 */
import { apiFetch, isReadOnlyServer } from './api/client.js';
import {
  ALERTS_SYNCED,
  KEY_URL,
  SUBSCRIPTIONS_URL,
  WORKER_TIMEOUT_MS,
  alertsWereOn,
  browserSupport,
  deviceNameOf,
  keyBytes,
  setAlertsOn,
  subscriptionIdOf,
} from './components/settings/sections/webPushData.js';

/** A sync is sent at least this often, so the server's "last seen" never reaches its 180 day drop. */
export const SYNC_EVERY_MS = 24 * 60 * 60 * 1000;

function lastSynced() {
  try {
    return Number(localStorage.getItem(ALERTS_SYNCED)) || 0;
  } catch {
    return 0;
  }
}

function markSynced(at) {
  try {
    localStorage.setItem(ALERTS_SYNCED, String(at));
  } catch {
    // storage blocked: it syncs every load
  }
}

const sameKey = (buf, key) =>
  !buf ||
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '') === key;

/** @param {{ now?: () => number, force?: boolean }} [opts] */
export async function syncWebPush({ now = Date.now, force = false } = {}) {
  if (isReadOnlyServer()) return 'off';
  const was = alertsWereOn();
  if (browserSupport() !== 'ok') return was ? 'stopped' : 'off';
  if (Notification.permission !== 'granted') return was ? 'stopped' : 'off';
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), WORKER_TIMEOUT_MS)),
    ]);
    let sub = await reg.pushManager.getSubscription();
    if (!sub && !was) return 'off';
    const k = await apiFetch(KEY_URL, { cache: 'no-store' });
    if (!k.ok) return 'ok';
    const server = await k.json();
    if (!server.enabled) return was ? 'stopped' : 'off';
    let healed = false;
    if (sub && !sameKey(sub.options?.applicationServerKey, server.publicKey)) {
      await sub.unsubscribe(); // made for another server key
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(server.publicKey),
      });
      healed = true;
    }
    const id = await subscriptionIdOf(sub.endpoint);
    const list = await apiFetch(SUBSCRIPTIONS_URL, { cache: 'no-store' });
    const listed = list.ok && ((await list.json()).subscriptions ?? []).some((s) => s.id === id);
    if (list.ok && listed && !healed && !force && now() - lastSynced() < SYNC_EVERY_MS) return 'ok';
    const post = await apiFetch(SUBSCRIPTIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), name: deviceNameOf(navigator.userAgent) }),
    });
    if (!post.ok) return post.status >= 500 ? 'ok' : 'stopped';
    setAlertsOn(true);
    markSynced(now());
    return healed || !listed ? 'healed' : 'ok';
  } catch (err) {
    // A refused subscribe means the browser took it back; anything else (offline, no
    // worker yet) says nothing about the alerts. Never the error's text: it can name a URL.
    return err?.name === 'NotAllowedError' || err?.name === 'InvalidStateError' ? 'stopped' : 'ok';
  }
}

/**
 * The "Turn them back on" button: from a click, so the permission prompt may
 * show when it hasn't been decided. 'ok' or 'healed' when alerts are on again;
 * 'stopped' when they can't be from here (the browser blocks them): Settings says how.
 */
export async function turnAlertsBackOn() {
  if (browserSupport() !== 'ok') return 'stopped';
  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'stopped';
  setAlertsOn(true);
  const out = await syncWebPush({ force: true });
  return out === 'off' ? 'stopped' : out;
}
