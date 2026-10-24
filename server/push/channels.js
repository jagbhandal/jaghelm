// @ts-check
/**
 * Push's two channels behind one face (#653): FCM for the Android app and Web
 * Push for the installed dashboard. The outbox, the cycle and the test push
 * were written against one token store and one sender; these give them both
 * without changing them:
 *
 *  - createCombinedStore: the FCM token store and the Web Push store as one.
 *    A device is either an FCM token or a Web Push subscription (the latter
 *    under the pseudo token `wp:<id>`, webPushStore.js), listed together in
 *    Settings → Notifications, each with its own prefs and delivery record.
 *  - createChannels: `isPushEnabled()` (either channel is up) and
 *    `sendToToken(token, event)`, routed by the token's kind. A channel that
 *    is off sends nothing and says so in the answer, never throws.
 *
 * Both are tiny routers: the logic is in tokenStore.js, webPushStore.js,
 * fcm.js and webPush.js.
 */
import { createWebPushSender, readVapid } from './webPush.js';
import { isWebToken } from './webPushStore.js';

/**
 * @param {ReturnType<typeof import('./tokenStore.js').createTokenStore>} fcmStore
 * @param {ReturnType<typeof import('./webPushStore.js').createWebPushStore>} webStore
 */
export function createCombinedStore(fcmStore, webStore) {
  /** @param {string} token */
  const forToken = (token) => (isWebToken(token) ? webStore : fcmStore);
  return {
    // FCM only: the Android app's registration and prefs. A `wp:` token is no FCM token.
    registerToken: fcmStore.registerToken,
    getToken: fcmStore.getToken,
    // By the token's kind.
    /** @param {string} token */
    removeToken: (token) => forToken(token).removeToken(token),
    /** @param {string} token */
    getPrefs: (token) => forToken(token).getPrefs(token),
    /** @param {string} token @param {unknown} prefs */
    setPrefs: (token, prefs) => forToken(token).setPrefs(token, prefs),
    /** @param {string} token @param {string | undefined} code */
    recordFailure: (token, code) => forToken(token).recordFailure(token, code),
    /** @param {Iterable<string>} tokens */
    markDelivered(tokens) {
      const list = [...tokens];
      return (
        fcmStore.markDelivered(list.filter((t) => !isWebToken(t))) +
        webStore.markDelivered(list.filter(isWebToken))
      );
    },
    getAllTokens: () => [...fcmStore.getAllTokens(), ...webStore.getAllTokens()],
    getDevices: () =>
      [...fcmStore.getDevices(), ...webStore.getDevices()].sort(
        (a, b) => a.registeredAt - b.registeredAt || a.id.localeCompare(b.id)
      ),
    /** @param {string} id */
    tokenOfDevice: (id) => fcmStore.tokenOfDevice(id) ?? webStore.tokenOfDevice(id),
    /** @param {string} id */
    removeDevice: (id) => fcmStore.removeDevice(id) || webStore.removeDevice(id),
    pruneStale: () => fcmStore.pruneStale() + webStore.pruneStale(),
  };
}

/**
 * @param {{ isPushEnabled: () => boolean, sendToToken: (token: string, event: object) => Promise<object> }} fcm  push/fcm.js
 * @param {() => ReturnType<typeof createWebPushSender> | null} webPush  the Web Push sender, once initialised
 */
export function createChannels(fcm, webPush) {
  return {
    isPushEnabled: () => fcm.isPushEnabled() || webPush()?.isEnabled() === true,
    /** Which channels are up: for Settings, to say which one is missing. */
    status: () => ({ fcm: fcm.isPushEnabled(), web: webPush()?.isEnabled() === true }),
    /** @param {string} token @param {object} event */
    sendToToken(token, event) {
      if (isWebToken(token)) {
        const sender = webPush();
        return sender
          ? sender.sendToToken(token, event)
          : Promise.resolve({ ok: false, prune: false, retry: false, allPhones: false, error: 'webpush/disabled' });
      }
      return fcm.sendToToken(token, event);
    },
  };
}

// ── the process's own ───────────────────────────────────────────────────────

/** @type {ReturnType<typeof createWebPushSender> | null} */
let webSender = null;
/** @type {ReturnType<typeof readVapid>} */
let vapid = { enabled: false, reason: 'unset' };

/**
 * Read the VAPID settings and build the Web Push sender (boot, after the FCM
 * init). Never throws: Web Push stays off, with the reason, and FCM is
 * untouched.
 * @param {{ store: Parameters<typeof createWebPushSender>[0]['store'], env?: Record<string, string | undefined>, logger?: { info: Function, warn: Function }, fetchImpl?: typeof fetch }} deps
 */
export function initWebPush({ store, env, logger, fetchImpl }) {
  vapid = readVapid(env);
  webSender = createWebPushSender({ vapid, store, ...(fetchImpl ? { fetchImpl } : {}), ...(logger ? { logger } : {}) });
  if (vapid.enabled) logger?.info('web push enabled: VAPID keys loaded');
  else if (vapid.reason === 'unset') logger?.info('web push disabled: no VAPID keys configured');
  else logger?.warn({ reason: vapid.reason, detail: vapid.detail }, 'web push disabled: the VAPID settings are not usable');
  return webSender;
}

/** The Web Push sender, or null before initWebPush. */
export const getWebSender = () => webSender;

/** Whether Web Push is up, and if not why (`unset`, `incomplete`, `invalid`); for the Settings screen. */
export function webPushStatus() {
  return vapid.enabled
    ? { enabled: true, publicKey: vapid.publicKey }
    : { enabled: false, reason: vapid.reason };
}
