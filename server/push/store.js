import { createChannels, createCombinedStore, getWebSender } from './channels.js';
import * as fcm from './fcm.js';
import { createTokenStore } from './tokenStore.js';
import { createWebPushStore } from './webPushStore.js';

// Process-wide singletons. The dispatch cycle (refresh.js) and the push routes
// (routes/push.js) MUST share one in-memory instance of each store, or a token
// registered via a route would be invisible to the cycle (and vice-versa) until
// a restart. They persist to data/push-tokens.json (FCM) and
// data/push-subscriptions.json (Web Push, #653), for durability.
let fcmStore = null;
let webStore = null;
let combined = null;

/** The FCM token store, constructed lazily on first use. */
export function getFcmTokenStore() {
  if (!fcmStore) fcmStore = createTokenStore({});
  return fcmStore;
}

/** The Web Push subscription store, constructed lazily on first use. */
export function getWebPushStore() {
  if (!webStore) webStore = createWebPushStore({});
  return webStore;
}

/**
 * The shared token store: FCM tokens and Web Push subscriptions as one list of
 * devices (channels.js). What the cycle, the outbox, the test push and the
 * routes use.
 */
export function getPushStore() {
  if (!combined) combined = createCombinedStore(getFcmTokenStore(), getWebPushStore());
  return combined;
}

let channelsInstance = null;
/** The sender the outbox, test push and cycle use: FCM and Web Push behind one face. */
export function getPushChannels() {
  if (!channelsInstance) channelsInstance = createChannels(fcm, getWebSender);
  return channelsInstance;
}
