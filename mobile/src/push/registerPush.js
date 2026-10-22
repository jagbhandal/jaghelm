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
import { SIGN_OUT_TIMEOUT_MS } from '@shared/api/client.js';
import { getPref, setPref } from '../storage/prefsAdapter.js';
import { PUSH_PERM_KEY, PUSH_TOKEN_KEY } from '../runtimeConfig.js';
import { registerToken, deleteToken } from './pushPrefsApi.js';
import { routeFromData } from './routeFromData.js';
import { routeFromUrl } from './routeFromUrl.js';
import { isPushConfigured } from './pushConfig.js';

const CHANNEL_ID = 'jaghelm-incidents';

// The appUrlOpen listener initPush added. PushNotifications.removeAllListeners()
// doesn't reach @capacitor/app's listeners, so this one is removed by its handle.
let appUrlOpenHandle = null;

/** Remove every listener initPush added: the four plugin ones and appUrlOpen. */
async function removePushListeners() {
  const handle = appUrlOpenHandle;
  appUrlOpenHandle = null;
  try {
    await PushNotifications.removeAllListeners();
  } finally {
    if (handle) await handle.remove();
  }
}

export async function initPush({ nav }) {
  // HARD GATE: register() needs Firebase (google-services.json). Without it, it
  // throws an UNCAUGHT native exception on the CapacitorPlugins thread that
  // crashes the whole app — JS try/catch cannot stop it. So when push isn't
  // configured in this build, do NOTHING (no register, no permission prompt).
  if (!isPushConfigured()) {
    return { enabled: false, reason: 'not-configured' };
  }

  // Belt-and-suspenders: any JS-level push failure degrades to disabled rather
  // than escaping into MobileApp's mount effect as an unhandled rejection.
  try {
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

    // A sign-in after a sign-out in the same run mounts MobileApp again: drop
    // what an earlier call added, so the listeners don't stack (#531).
    await removePushListeners();

    // Listeners BEFORE register() — 'registration' may fire immediately.
    await PushNotifications.addListener('registration', (token) => onRegistration(token));
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
    appUrlOpenHandle = await App.addListener('appUrlOpen', (event) => {
      routeFromUrl(event && event.url, nav);
    });

    await PushNotifications.register();
    return { enabled: true, permission: 'granted' };
  } catch (e) {
    console.warn('[push] init failed; push disabled:', e && e.message);
    return { enabled: false, error: e && e.message };
  }
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

/**
 * Teardown for the explicit push-disable (Turn off push on this device; sign-out
 * has its own, unregisterPush below): remove plugin listeners, hard-remove the
 * registration server-side (DELETE /push/register — token in body), and clear
 * the locally-cached FCM token. Uses setPref('', ) NOT removeItem,
 * which (on the Keystore adapter) throws on a missing key (M3a) — Preferences is
 * throw-free regardless, and push state never lives in the Keystore.
 *
 * This is the HARD path. The settings master toggle (enabled:false) is the SOFT
 * path (PUT /push/prefs, token KEPT) and must NOT call this.
 */
export async function disablePush(token) {
  await PushNotifications.removeAllListeners();
  if (token) {
    try {
      await deleteToken(token);
    } catch (e) {
      console.warn('[push] backend delete failed:', e && e.message);
    }
  }
  await setPref(PUSH_TOKEN_KEY, '');
}

/** The FCM token the 'registration' handler stored, or '' (none, or the read failed). */
export async function cachedPushToken() {
  try {
    return (await getPref(PUSH_TOKEN_KEY)) || '';
  } catch {
    return '';
  }
}

/**
 * Sign-out's push teardown (#531), for Log out and Forget this device, which
 * call it before revoking the session: DELETE /push/register needs a live one.
 * The DELETE is sent within the call (apiFetch takes the session token as it
 * sends). Push is then torn down on the phone without waiting for the answer:
 * the listeners go (appUrlOpen too), PushNotifications.unregister() deletes
 * the FCM token, so the phone shows no more pushes even if the DELETE is lost
 * and the server's next send to the old token fails and prunes it, and the
 * cached token is cleared. The next sign-in registers a new token (initPush). Never rejects;
 * stops waiting for the DELETE after SIGN_OUT_TIMEOUT_MS. A build without push
 * touches nothing (the plugin would crash it, see pushConfig.js).
 */
export async function unregisterPush(token) {
  if (!isPushConfigured()) return;
  let deleted;
  if (token) {
    let timer;
    deleted = Promise.race([
      deleteToken(token).catch((e) => console.warn('[push] backend delete failed:', e && e.message)),
      new Promise((resolve) => {
        timer = setTimeout(resolve, SIGN_OUT_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
  }
  // Each step on its own, so one that fails doesn't skip the others.
  const steps = [
    () => removePushListeners(),
    () => PushNotifications.unregister(),
    () => setPref(PUSH_TOKEN_KEY, ''),
  ];
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      console.warn('[push] sign-out teardown step failed:', e && e.message);
    }
  }
  await deleted;
}
