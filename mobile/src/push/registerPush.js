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
 *
 * The user's choice gates all of it (#539): after Turn off push on this device
 * (disablePush), initPush does nothing until Turn on (enablePush), restarts
 * included. Permission granted is not push wanted. A sign-out or Turn off push
 * that didn't finish (auth/pendingCleanup.js) is retried before registering.
 */
import { PushNotifications } from '@capacitor/push-notifications';
import { App } from '@capacitor/app';
import { SIGN_OUT_TIMEOUT_MS, getAuthToken } from '@shared/api/client.js';
import { getApiBase } from '@shared/api/baseUrl.js';
import { getPref, setPref } from '../storage/prefsAdapter.js';
import { PUSH_PERM_KEY, PUSH_TOKEN_KEY, PUSH_WANTED_KEY } from '../runtimeConfig.js';
import { registerToken, deleteToken } from './pushPrefsApi.js';
import {
  dropPushSteps,
  outcomeOf,
  rememberCleanup,
  runPendingCleanup,
} from '../auth/pendingCleanup.js';
import { routeFromData } from './routeFromData.js';
import { routeFromUrl } from './routeFromUrl.js';
import { isPushConfigured } from './pushConfig.js';

const CHANNEL_ID = 'jaghelm-incidents';

/** How long Turn on push waits for the new FCM token before the screen reloads anyway. */
export const ENABLE_WAIT_MS = 10000;

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
    // Turned off on this device: no prompt, no listeners, no register (#539).
    if (!(await pushWanted())) return { enabled: false, reason: 'turned-off' };

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

    // An earlier sign-out or Turn off push that didn't finish goes first, then
    // its push steps give way to this registration (#539).
    await runPendingCleanup();
    await dropPushSteps(getApiBase());

    // A sign-in after a sign-out in the same run mounts MobileApp again: drop
    // what an earlier call added, so the listeners don't stack (#531).
    await removePushListeners();

    // Listeners BEFORE register() — 'registration' may fire immediately.
    await PushNotifications.addListener('registration', (token) => onRegistration(token));
    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('[push] registration error:', err && err.error);
      settleWaiters('');
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

// Turn on push waits for the token its register() brings (enablePush).
let waiters = [];
function settleWaiters(value) {
  const done = waiters;
  waiters = [];
  for (const resolve of done) resolve(value);
}
function nextRegistration(ms) {
  return new Promise((resolve) => {
    let timer;
    const done = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => {
      waiters = waiters.filter((w) => w !== done);
      resolve('');
    }, ms);
    waiters.push(done);
  });
}

/** 'registration' handler: persist the FCM token (note: event.value) + POST it. */
async function onRegistration(token) {
  const value = token && token.value; // field is `value`, NOT `token`
  if (!value) return;
  try {
    await setPref(PUSH_TOKEN_KEY, value);
    await registerToken(value);
  } catch (e) {
    console.warn('[push] backend register failed:', e && e.message);
  } finally {
    settleWaiters(value);
  }
}

/** The user's push choice on this phone: on unless Turn off push set it off (#539). */
export async function pushWanted() {
  try {
    return (await getPref(PUSH_WANTED_KEY)) !== 'false';
  } catch {
    return true;
  }
}

/**
 * Turn off push on this device: the choice goes off first, so no restart
 * registers again, then push comes down as at sign-out (unregisterPush: the
 * DELETE with the live session, then the FCM token deletion) and whatever
 * didn't finish is kept and retried (#539). The session stays. Never rejects.
 *
 * This is the HARD path. The settings master toggle (enabled:false) is the SOFT
 * path (PUT /push/prefs, token KEPT) and must NOT call this.
 */
export async function disablePush(token) {
  try {
    await setPref(PUSH_WANTED_KEY, 'false');
  } catch (e) {
    console.warn('[push] could not store the choice:', e && e.message);
  }
  if (!isPushConfigured()) return;
  const serverUrl = getApiBase();
  const sessionToken = getAuthToken();
  const push = unregisterPush(token);
  await rememberCleanup({ serverUrl, sessionToken, pushToken: token, push });
}

/**
 * Turn push back on: the choice goes on and initPush registers, which brings
 * a fresh FCM token (the old one was deleted). Answers initPush's result plus
 * `token`, the new token once it is registered, or '' if none came within
 * ENABLE_WAIT_MS. Never rejects.
 */
export async function enablePush({ nav }) {
  try {
    await setPref(PUSH_WANTED_KEY, 'true');
  } catch (e) {
    return { enabled: false, error: e && e.message };
  }
  const registered = nextRegistration(ENABLE_WAIT_MS);
  const r = await initPush({ nav });
  if (!r.enabled) {
    settleWaiters('');
    return r;
  }
  return { ...r, token: await registered };
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
 * Push teardown for Log out and Forget this device (#531), which call it
 * before revoking the session (DELETE /push/register needs a live one), and for
 * Turn off push (#539). The DELETE is sent within the call (apiFetch takes the
 * session token as it sends). Push is then torn down on the phone without
 * waiting for the answer: the listeners go (appUrlOpen too),
 * PushNotifications.unregister() deletes the FCM token, so the phone shows no
 * more pushes even if the DELETE is lost and the server's next send to the old
 * token fails and prunes it, and the cached token is cleared. The next
 * sign-in or Turn on registers a new token (initPush).
 *
 * Answers { deleted, unregistered } for the pending cleanup: deleted is
 * outcomeOf the DELETE ('done' with no token to delete; 'failed' when it met a
 * network error, a 5xx or SIGN_OUT_TIMEOUT_MS), unregistered whether the
 * plugin's unregister() resolved. Never rejects. A build without push touches
 * nothing (the plugin would crash it, see pushConfig.js) and has nothing left.
 */
export async function unregisterPush(token) {
  if (!isPushConfigured()) return { deleted: 'done', unregistered: true };
  let deleted = Promise.resolve('done');
  if (token) {
    let timer;
    deleted = Promise.race([
      deleteToken(token).then(
        () => 'done',
        (e) => {
          console.warn('[push] backend delete failed:', e && e.message);
          return outcomeOf(e && e.status);
        },
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve('failed'), SIGN_OUT_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
  }
  let unregistered = false;
  // Each step on its own, so one that fails doesn't skip the others.
  const steps = [
    () => removePushListeners(),
    async () => {
      await PushNotifications.unregister();
      unregistered = true;
    },
    () => setPref(PUSH_TOKEN_KEY, ''),
  ];
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      console.warn('[push] teardown step failed:', e && e.message);
    }
  }
  return { deleted: await deleted, unregistered };
}
