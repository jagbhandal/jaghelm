import { createTokenStore } from './tokenStore.js';

// Process-wide singleton token store. The dispatch cycle (refresh.js) and the
// push routes (routes/push.js) MUST share one in-memory instance, or a token
// registered via a route would be invisible to the cycle (and vice-versa) until
// a restart. The store persists to data/push-tokens.json for durability.
let store = null;

/** The shared token store, constructed lazily on first use. */
export function getPushStore() {
  if (!store) store = createTokenStore({});
  return store;
}
