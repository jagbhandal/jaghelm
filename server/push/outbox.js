/**
 * The push outbox's sender (#579): the one thing that sends the refresh loop's
 * pushes. The cycle queues each cycle's events in the outbox with the snapshot
 * it advanced to (push/dispatch.js createPushSnapshot, one write) and wakes the
 * sender; it never waits on a send, so a Google that doesn't answer (up to
 * ~145 s a send, push/fcmHttp.js) holds up neither the board nor /api/health.
 *
 * One drain at a time, one event at a time, oldest first: no two sends
 * overlap and nothing is sent out of order. Each event goes to every phone
 * whose preferences take it (shouldDeliver), each phone once:
 *  - accepted, or failed for a reason of the phone's or the message's own
 *    (a dead token, pruned; a payload FCM refuses; fcm.js logs each as
 *    before): done with that phone;
 *  - failed for a reason that says nothing about either (fcm.js `retry`:
 *    Google out of reach or failing, the key refused, the quota spent):
 *    the event stays at the head and is tried again, for the phones still
 *    owed it, after RETRY_BACKOFF_MS. What is queued behind it waits.
 * When every phone is done, the event leaves the outbox (written at once). A
 * crash between that send and that write sends it again after the restart: a
 * page twice rather than none.
 *
 * Nothing to do at shutdown: the outbox is on disk with every change, and a
 * restart's first cycle wakes the sender on what it holds. Its wait between
 * tries never keeps the process alive.
 */
import { setTimeout as delay } from 'node:timers/promises';

import { createLogger } from '../util/logger.js';
import { settleTokens, shouldDeliver } from './dispatch.js';

const defaultLog = createLogger('push-outbox');

/**
 * The waits before each try again of an event Google failed, by how many
 * tries in a row have failed: 10 s, 30 s, 1 min, 2 min, then every 5 minutes.
 * A try with Google out of reach already takes minutes, so this adds little
 * load, and a short outage is caught up within a minute of its end.
 */
export const RETRY_BACKOFF_MS = Object.freeze([10_000, 30_000, 60_000, 120_000, 300_000]);

/** A wait that never keeps the process alive. */
const unrefSleep = (ms) => delay(ms, undefined, { ref: false });

const named = (event) => ({ type: event.type, id: event.id });

/**
 * @param {object}   deps
 * @param {object}   deps.outbox   the snapshot memory that holds the outbox (createPushSnapshot)
 * @param {object|Function} deps.store  the token store, or a function giving it (built on first use)
 * @param {object}   deps.fcm      fcm module (sendToToken)
 * @param {object}   [deps.logger]
 * @param {(ms: number) => Promise<unknown>} [deps.sleep]  the wait between tries (injected in tests)
 * @param {readonly number[]} [deps.backoffMs]
 * @returns {{ wake: () => void, idle: () => Promise<void> }}
 */
export function createPushSender({
  outbox,
  store,
  fcm,
  logger = defaultLog,
  sleep = unrefSleep,
  backoffMs = RETRY_BACKOFF_MS,
}) {
  const tokenStore = typeof store === 'function' ? store : () => store;
  let draining = false;
  let drained = Promise.resolve();
  let failures = 0; // tries in a row that Google failed

  /**
   * Send `entry`'s event to each phone not done with it. Never throws.
   * @returns {Promise<string|null>} the code of a failure to try again after, or null: done
   */
  async function attempt(entry) {
    const tally = (entry.tally ??= { sent: 0, suppressed: 0, pruned: 0 });
    const delivered = new Set();
    const toPrune = new Set();
    let retry = null;
    try {
      const tokens = tokenStore();
      for (const { token } of tokens.getAllTokens()) {
        if (entry.done.has(token)) continue;
        if (!shouldDeliver(entry.event, tokens.getPrefs(token))) {
          tally.suppressed += 1;
          entry.done.add(token);
          continue;
        }
        let result;
        try {
          result = await fcm.sendToToken(token, entry.event);
        } catch (err) {
          logger.warn({ err }, 'push send threw');
          result = { ok: false, prune: false, retry: true, error: 'thrown' };
        }
        tally.sent += 1;
        if (result?.retry) {
          // Google's failure: the phones after this one would fail the same way.
          retry = result.error ?? 'unknown';
          break;
        }
        entry.done.add(token);
        if (result?.prune) toPrune.add(token);
        else if (result?.ok) delivered.add(token);
      }
      settleTokens(delivered, toPrune, { store: tokens, logger });
      tally.pruned += toPrune.size;
    } catch (err) {
      // The token store failed: try again later, as for Google.
      logger.error({ err }, 'push send error');
      retry = 'error';
    }
    return retry;
  }

  async function drain() {
    try {
      for (let entry = outbox.head(); entry !== null; entry = outbox.head()) {
        entry.sending = true; // a full outbox drops the oldest but this one
        const retry = await attempt(entry);
        if (retry !== null) {
          entry.sending = false; // waiting, it is the oldest like any other
          failures += 1;
          const wait = backoffMs[Math.min(failures, backoffMs.length) - 1];
          logger.warn(
            {
              ...named(entry.event),
              code: retry,
              tries: failures,
              retryInSec: wait / 1000,
              queued: outbox.outbox().length,
            },
            'push not sent, trying again later'
          );
          await sleep(wait);
          continue;
        }
        failures = 0;
        outbox.complete(entry);
        logger.info(
          { ...named(entry.event), ...entry.tally, queued: outbox.outbox().length },
          'push dispatched'
        );
      }
    } catch (err) {
      // Never seen: the head stays, and the next cycle wakes the sender again.
      logger.error({ err }, 'push sender error');
    } finally {
      draining = false;
    }
  }

  return {
    /** Start sending what the outbox holds, unless a drain already is. */
    wake() {
      if (draining) return;
      draining = true;
      drained = drain();
    },
    /** Settles when the drain running now (if any) has emptied the outbox. */
    idle() {
      return drained;
    },
  };
}
