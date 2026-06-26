/**
 * Mobile push registration. Behind @capacitor/push-notifications, mirroring the
 * adapter pattern so views import this and tests mock the plugin once.
 *
 * Flow (order is LOAD-BEARING):
 *   1. checkPermissions(); if 'prompt'/'prompt-with-rationale' -> requestPermissions()
 *      (this is what drives the Android 13+ POST_NOTIFICATIONS dialog).
 *   2. if receive !== 'granted' -> persist perm, early-return disabled (no listeners,
 *      no register) — gracefully disabled client-side.
 *   3. on grant: createChannel('jaghelm-incidents'), add the FOUR listeners FIRST
 *      (the 'registration' event can fire immediately), THEN register().
 *
 * register() does NOT prompt and does NOT request permission — that is why
 * requestPermissions() must precede it. The FCM token arrives via the
 * 'registration' listener as { value } (NOT { token }).
 */
import { PushNotifications } from '@capacitor/push-notifications';
import { App } from '@capacitor/app';
import { setPref } from '../storage/prefsAdapter.js';
import { PUSH_PERM_KEY, PUSH_TOKEN_KEY } from '../runtimeConfig.js';
import { registerToken } from './pushPrefsApi.js';
import { routeFromData } from './routeFromData.js';
import { routeFromUrl } from './routeFromUrl.js';

const CHANNEL_ID = 'jaghelm-incidents';

export async function initPush({ nav }) {
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== 'granted') {
    await setPref(PUSH_PERM_KEY, perm.receive);
    return { enabled: false, permission: perm.receive };
  }
  await setPref(PUSH_PERM_KEY, 'granted');

  // Matches the server payload's android.notification.channelId. Importance 5
  // (MAX) so critical (priority:high) pushes are not silenced on Android 8+.
  await PushNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'JagHelm incidents',
    importance: 5,
    visibility: 1,
  });

  // Listeners BEFORE register() — 'registration' may fire immediately.
  await PushNotifications.addListener('registration', (token) => {
    onRegistration(token);
  });
  await PushNotifications.addListener('registrationError', (err) => {
    console.warn('[push] registration error:', err && err.error);
  });
  await PushNotifications.addListener('pushNotificationReceived', () => {
    // Foreground arrival: Android does not auto-show in the tray. v1 logs only
    // (no in-app toast); the deep-link path is the action-performed listener.
  });
  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    routeFromData(action && action.notification && action.notification.data, nav);
  });

  // Deep-link path B: the jaghelm://incident/<id> custom URL scheme (DESIGN line
  // 307 — the primary OSS-build deep-link path). Same nav, same reconciler.
  await App.addListener('appUrlOpen', (event) => {
    routeFromUrl(event && event.url, nav);
  });

  await PushNotifications.register();
  return { enabled: true, permission: 'granted' };
}

/** 'registration' handler: persist the FCM token (note: event.value) + POST it. */
async function onRegistration(token) {
  const value = token && token.value; // field is `value`, NOT `token`
  if (!value) return;
  await setPref(PUSH_TOKEN_KEY, value);
  try {
    await registerToken(value);
  } catch (e) {
    console.warn('[push] backend register failed:', e && e.message);
  }
}
