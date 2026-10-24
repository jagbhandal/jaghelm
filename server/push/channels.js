// @ts-check
/**
 * Push's channel behind one face (#653, #659): Web Push to the installed
 * dashboard is the only one. The outbox, the cycle and the test push are
 * written against one sender, `createChannels`, which gives them:
 *
 *  - `isPushEnabled()`: whether Web Push is up (the VAPID keys are set and fit).
 *  - `sendToToken(token, event)` for a subscription's pseudo token `wp:<id>`
 *    (webPushStore.js). A channel that is off sends nothing and says so in the
 *    answer, never throws.
 *
 * It is a tiny router: the logic is in webPushStore.js and webPush.js.
 */
import { createWebPushSender, readVapid } from './webPush.js';
import { isWebToken } from './webPushStore.js';

/** How many Web Push subscriptions one event goes to at once. */
export const WEB_CONCURRENCY = 4;
/** A send started ahead of the outbox's call is used for this long, else it is sent afresh. */
const AHEAD_MS = 5000;
/** A subscription that failed for a retry is not sent ahead for this long: the outbox's backoff is its own. */
const RETRY_QUIET_MS = 5 * 60 * 1000;

/**
 * Web Push as the one sender. The outbox sends one phone at a time, and a
 * push service that does not answer costs up to 10 s a send, so the Web Push
 * subscriptions an event is going to are sent together, WEB_CONCURRENCY at a
 * time, the first time the outbox asks for one of them in a round; its calls
 * for the others then take what is already on its way. A send never throws,
 * so one browser's failure is its own answer and cannot reach another's.
 *
 * @param {() => ReturnType<typeof createWebPushSender> | null} webPush  the Web Push sender, once initialised
 * @param {{ webTokens?: ((event: object) => string[]) | null, now?: () => number, concurrency?: number }} [ahead]
 *   `webTokens(event)`: the subscriptions the outbox will send `event` to (their prefs take it)
 */
export function createChannels(webPush, { webTokens = null, now = () => Date.now(), concurrency = WEB_CONCURRENCY } = {}) {
  /** @type {WeakMap<object, { at: number, sends: Map<string, Promise<object>> }>} */
  const rounds = new WeakMap();
  /** @type {Map<string, number>} when each subscription last failed for a retry */
  const failedAt = new Map();

  /** @param {Array<() => Promise<void>>} jobs */
  async function runBounded(jobs) {
    let next = 0;
    const lane = async () => {
      while (next < jobs.length) await jobs[next++]();
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, lane));
  }

  /** Send to every subscription `event` is going to, together; remember each answer for the outbox's call. */
  /** @param {{ sendToToken: (token: string, event: object) => Promise<any> }} sender @param {object} event */
  function startAhead(sender, event) {
    const at = now();
    const sends = new Map();
    rounds.set(event, { at, sends });
    const tokens = (webTokens?.(event) ?? []).filter((t) => at - (failedAt.get(t) ?? -Infinity) > RETRY_QUIET_MS);
    const jobs = tokens.map((token) => {
      /** @type {() => void} */
      let start = () => {};
      const started = new Promise((resolve) => (start = () => resolve(undefined)));
      const promise = started
        .then(() => sender.sendToToken(token, event))
        .catch(() => ({ ok: false, prune: false, retry: true, allPhones: false, error: 'thrown' }))
        .then((result) => {
          if (result?.retry) failedAt.set(token, now());
          else failedAt.delete(token);
          return result;
        });
      sends.set(token, promise);
      return async () => {
        start();
        await promise;
      };
    });
    void runBounded(jobs);
  }

  return {
    isPushEnabled: () => webPush()?.isEnabled() === true,
    /** Which channels are up: for Settings. */
    status: () => ({ web: webPush()?.isEnabled() === true }),
    /** @param {string} token @param {object} event */
    sendToToken(token, event) {
      // Only a Web Push subscription is a device now: any other token is nobody's.
      if (!isWebToken(token)) {
        return Promise.resolve({ ok: false, prune: false, retry: false, allPhones: false, error: 'push/unknown-device' });
      }
      const sender = webPush();
      if (!sender) {
        return Promise.resolve({ ok: false, prune: false, retry: false, allPhones: false, error: 'webpush/disabled' });
      }
      if (typeof webTokens === 'function' && event && typeof event === 'object') {
        const round = rounds.get(event);
        if (!round || now() - round.at > AHEAD_MS) startAhead(sender, event);
        const send = rounds.get(event)?.sends.get(token);
        if (send) {
          rounds.get(event)?.sends.delete(token);
          return send;
        }
      }
      return sender.sendToToken(token, event);
    },
  };
}

// ── the process's own ───────────────────────────────────────────────────────

/** @type {ReturnType<typeof createWebPushSender> | null} */
let webSender = null;
/** @type {ReturnType<typeof readVapid>} */
let vapid = { enabled: false, reason: 'unset' };

/**
 * Read the VAPID settings and build the Web Push sender (boot). Never throws:
 * Web Push stays off, with the reason.
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
    : { enabled: false, reason: vapid.reason, ...(vapid.detail ? { detail: vapid.detail } : {}) };
}
