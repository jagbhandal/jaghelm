/**
 * "Send test push" (#320, closes #268): proves push works end to end, to one
 * phone or to every registered one, from Settings → Notifications.
 *
 * A test push is a push like any other: recorded in the alert history (GET
 * /api/events, type `push_test`, severity info) and queued in the outbox, so
 * the sender sends it in order with the rest, with the same retries
 * (push/outbox.js). Sent to one phone, the event carries that phone's
 * fingerprint (`device`), and the sender gives it to that phone alone. No
 * category switch keeps it from a phone; the app's own switch for push does
 * (dispatch.js TEST_PUSH).
 *
 * One test push per phone every 30 seconds (TEST_PUSH_COOLDOWN_MS), counted
 * here, in memory: one to every phone counts for each. What became of the
 * last one, phone by phone, is followed through the sender's results
 * (onResult) and told in words (last()): delivered (the push service accepted it),
 * switched off in the app, failed (and why, push/sendWords.js), or still on
 * its way, and when the push service can't be reached at all, that it waits for it
 * (the sender's stalled()). Only the last test push is followed, and a
 * restart forgets it; its history record stays.
 */
import { createLogger } from '../util/logger.js';
import { TEST_PUSH } from './dispatch.js';
import { sendFailureWords } from './sendWords.js';
import { deviceIdOf } from './prefs.js';

const defaultLog = createLogger('push-test');

/** The shortest time between two test pushes to one phone. */
export const TEST_PUSH_COOLDOWN_MS = 30_000;

/** What the test push says on the phone. */
export const TEST_PUSH_TITLE = 'JagHelm test push';
export const TEST_PUSH_BODY =
  'Sent from Settings → Notifications. If you can read this, push works on this phone.';

/** A phone's outcome that is final: nothing more will happen to the test push on it. */
const FINAL = new Set(['sent', 'off', 'failed', 'removed']);

/** One phone's outcome in words. */
function outcomeWords({ state, code }, stalled) {
  switch (state) {
    case 'sent':
      return "Delivered: the browser's push service accepted it. It shows unless JagHelm is open on screen.";
    case 'off':
      return 'Not sent: push is switched off for this device.';
    case 'failed':
      return `Failed: ${sendFailureWords(code)}.`;
    case 'removed':
      return `Failed: ${sendFailureWords(code)}. JagHelm removed this browser; turn alerts on again in Settings to register it.`;
    case 'retrying':
      return `Not delivered yet: ${sendFailureWords(code)}.`;
    default:
      return stalled
        ? `Waiting: ${sendFailureWords(stalled.code)}. It goes out once the push service answers.`
        : 'Sending…';
  }
}

/**
 * @param {object} deps
 * @param {object} deps.snapshot  the push snapshot (dispatch.js createPushSnapshot): queue()
 * @param {object} deps.sender    the outbox's sender (outbox.js): wake(), stalled()
 * @param {object|Function} deps.store  the token store, or a function giving it
 * @param {object} deps.channels  push/channels.js createChannels: isPushEnabled()
 * @param {() => number} [deps.now]
 * @param {object} [deps.logger]
 */
export function createTestPush({
  snapshot,
  sender,
  store,
  channels,
  now = () => Date.now(),
  logger = defaultLog,
}) {
  const tokenStore = typeof store === 'function' ? store : () => store;
  /** @type {Map<string, number>} each phone's last test push, by fingerprint */
  const lastSent = new Map();
  /**
   * The last test push: its event (the object the sender sends), when, its
   * phone (null: every phone), its history record and each phone's outcome.
   * @type {{ event: object, at: number, device: string | null, historyId: string, results: Map<string, { state: string, code?: string }> } | null}
   */
  let last = null;

  /**
   * The last test push in words, or null: `{ at, device, historyId, done,
   * sentence, results: [{ device, state, sentence }] }`. `state` per phone
   * is queued, retrying, sent, off, failed or removed; `done` once every
   * phone's is final. `sentence` sums it up ("Delivered to 2 of 2 phones").
   */
  function view() {
    if (!last) return null;
    const stalled = sender.stalled?.() ?? null;
    // A phone removed before its send is done with it: nothing more will happen.
    const registered = new Set(
      tokenStore()
        .getDevices()
        .map((p) => p.id)
    );
    const results = [...last.results].map(([id, r]) => {
      const gone = !FINAL.has(r.state) && !registered.has(id);
      return {
        device: id,
        state: gone ? 'removed' : r.state,
        sentence: gone ? 'Not sent: the phone was removed first.' : outcomeWords(r, stalled),
      };
    });
    const done = results.every((r) => FINAL.has(r.state));
    const sent = results.filter((r) => r.state === 'sent').length;
    let sentence;
    if (results.length === 1) sentence = results[0].sentence;
    else if (done) sentence = `Delivered to ${sent} of ${results.length} phones.`;
    else if (stalled) sentence = outcomeWords({ state: 'queued' }, stalled);
    else sentence = `Sending to ${results.length} phones…`;
    return {
      at: new Date(last.at).toISOString(),
      device: last.device,
      historyId: last.historyId,
      done,
      sentence,
      results,
    };
  }

  return {
    /**
     * Send a test push to the phone with fingerprint `device`, or to every
     * phone (null). `{ status: 202, body }` with last()'s view, or the
     * refusal: `{ status, error, code?, retryAfterS? }`.
     *
     * @param {string | null} device
     */
    send(device) {
      if (!channels.isPushEnabled()) {
        return {
          status: 409,
          code: 'push_off',
          error:
            'Push is off on this server: the Web Push keys (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) are not set in .env',
        };
      }
      const tokens = tokenStore();
      const phones = tokens.getDevices();
      if (device !== null && !phones.some((p) => p.id === device)) {
        return { status: 404, error: 'No registered phone has that id; reload the list' };
      }
      if (phones.length === 0) {
        return {
          status: 409,
          code: 'no_devices',
          error: 'No phone is registered: sign in to the JagHelm app on a phone first',
        };
      }
      const at = now();
      const targets = device === null ? phones : phones.filter((p) => p.id === device);
      const wait = Math.max(
        0,
        ...targets.map((p) => (lastSent.get(p.id) ?? -Infinity) + TEST_PUSH_COOLDOWN_MS - at)
      );
      if (wait > 0) {
        const retryAfterS = Math.ceil(wait / 1000);
        return {
          status: 429,
          retryAfterS,
          error: `One test push per phone every 30 seconds: try again in ${retryAfterS} s`,
        };
      }
      for (const p of targets) lastSent.set(p.id, at);

      const event = {
        type: TEST_PUSH,
        id: device ?? 'all',
        node: 'JagHelm',
        severity: 'info',
        title: TEST_PUSH_TITLE,
        body: TEST_PUSH_BODY,
        ...(device !== null ? { device } : {}),
      };
      const [historyId] = snapshot.queue([event]);
      last = {
        event,
        at,
        device,
        historyId,
        results: new Map(targets.map((p) => [p.id, { state: 'queued' }])),
      };
      logger.info({ phones: targets.length, device: device ?? 'all' }, 'test push queued');
      sender.wake();
      return { status: 202, body: view() };
    },

    /** The sender's result for one phone (outbox.js onResult): followed for the last test push. */
    onResult(event, token, outcome) {
      if (!last || event !== last.event) return;
      const id = deviceIdOf(token);
      if (!last.results.has(id)) return;
      last.results.set(id, {
        state: outcome.state,
        ...(outcome.code ? { code: outcome.code } : {}),
      });
    },

    /** The last test push in words (view), or null. */
    last: view,
  };
}
