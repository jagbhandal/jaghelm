import { createChannels, getWebSender } from './channels.js';
import { shouldDeliver } from './dispatch.js';
import { deviceIdOf } from './prefs.js';
import { createWebPushStore } from './webPushStore.js';

// Process-wide singletons. The dispatch cycle (refresh.js) and the push routes
// (routes/push.js, routes/webPush.js) MUST share one in-memory instance of the
// store, or a subscription registered via a route would be invisible to the
// cycle (and vice-versa) until a restart. It persists to
// data/push-subscriptions.json (Web Push, #653), for durability.
let webStore = null;

/** The Web Push subscription store, constructed lazily on first use. */
export function getWebPushStore() {
  if (!webStore) webStore = createWebPushStore({});
  return webStore;
}

/**
 * The shared device store: the Web Push subscriptions, as the cycle, the
 * outbox, the test push and the routes use them.
 */
export function getPushStore() {
  return getWebPushStore();
}

let channelsInstance = null;
/** The sender the outbox, test push and cycle use: Web Push behind the channel face. */
export function getPushChannels() {
  if (!channelsInstance) {
    channelsInstance = createChannels(getWebSender, {
      // The subscriptions the outbox will send an event to: its prefs take it, and a
      // test push for one device goes to that device alone.
      webTokens: (event) => {
        const web = getWebPushStore();
        return web
          .getAllTokens()
          .map(({ token }) => token)
          .filter((token) => (typeof event.device === 'string' ? deviceIdOf(token) === event.device : true))
          .filter((token) => shouldDeliver(event, web.getPrefs(token)));
      },
    });
  }
  return channelsInstance;
}
