/**
 * The push outbox's sender (#579): the one thing that sends the refresh loop's
 * pushes. The cycle queues each cycle's events in the outbox with the snapshot
 * it advanced to (push/dispatch.js createPushSnapshot, one write) and wakes the
 * sender; it never waits on a send, so a push service that doesn't answer (up to
 * ~10 s a send, push/webPush.js) holds up neither the board nor /api/health.
 *
 * One send at a time. Each round goes through the outbox oldest event first,
 * and sends each event to every phone whose preferences take it and that is
 * not waiting (below), so each phone gets its events in order and none twice:
 *  - accepted, or failed for a reason of the phone's or the message's own (a
 *    dead token, pruned; a payload the push service refuses; webPush.js logs each):
 *    that phone is done with the event;
 *  - failed in a way every phone would (webPush.js `allPhones`: the push service out of
 *    reach, the key refused): the round stops, and the next waits
 *    RETRY_BACKOFF_MS, longer each time it fails so;
 *  - failed for this phone only (`retry`: the push service failing this send, a 5xx or a
 *    429): that phone waits RETRY_BACKOFF_MS before it is tried again, and is
 *    sent nothing later meanwhile; the others go on. After GIVE_UP_TRIES (about
 *    an hour) on an event another phone took, it is given up for that phone,
 *    with one warn line. One no phone took is never given up: after a long
 *    outage, an open incident's page still goes out.
 * When every phone is done with an event, it leaves the outbox, with one info
 * line; the round writes the file once at its end, for every event it
 * finished or a phone took (#267: not a whole-file write per event while an
 * incident flaps). A crash between a send and that write sends it again after
 * the restart: a page twice rather than none.
 *
 * An event for one phone (`device`, its fingerprint: a test push to one phone,
 * #320) goes to that phone alone; the others are done with it without a
 * send, and aren't counted as having it switched off.
 *
 * What each phone did with each send is kept in the token store for Settings →
 * Notifications' device list (#320): an accepted send its delivery time
 * (settleTokens), a failed one, for this phone only, its code
 * (recordFailure). A failure every phone would share is the sender's own,
 * `stalled()`, until a round gets through. `onResult(event, token, outcome)`,
 * when given, hears each phone's outcome as it is known (push/testPush.js
 * follows its test pushes by it).
 *
 * New events cut a phone's wait short for the others' sake, never a wait for
 * the push service itself. Nothing to do at shutdown: the outbox is on disk with every
 * change, and a restart's first cycle wakes the sender on it. Its waits never
 * keep the process alive.
 */
import { setTimeout as delay } from 'node:timers/promises';

import { createLogger } from '../util/logger.js';
import { settleTokens, shouldDeliver } from './dispatch.js';
import { deviceIdOf } from './prefs.js';

const defaultLog = createLogger('push-outbox');

/**
 * The waits before trying again, by how many tries in a row have failed:
 * 10 s, 30 s, 1 min, 2 min, then every 5 minutes. A try with Google out of
 * reach already takes minutes, so this adds little load, and a short outage is
 * caught up within a minute of its end.
 */
export const RETRY_BACKOFF_MS = Object.freeze([10_000, 30_000, 60_000, 120_000, 300_000]);

/** Tries of one event for one phone, about an hour at RETRY_BACKOFF_MS, before it is given up for that phone. */
export const GIVE_UP_TRIES = 16;

/** A wait that never keeps the process alive. */
const unrefSleep = (ms) => delay(ms, undefined, { ref: false });

const named = (event) => ({ type: event.type, id: event.id });
/** A token as the sender logs it: its first 12 characters. */
const shortToken = (token) => String(token).slice(0, 12);

/**
 * @param {object}   deps
 * @param {object}   deps.outbox   the snapshot memory that holds the outbox (createPushSnapshot)
 * @param {object|Function} deps.store  the token store, or a function giving it (built on first use)
 * @param {object}   deps.channels  push/channels.js createChannels (sendToToken)
 * @param {object}   [deps.logger]
 * @param {(ms: number) => Promise<unknown>} [deps.sleep]  the wait between tries (injected in tests)
 * @param {() => number} [deps.now]  the clock a phone's wait is timed by
 * @param {readonly number[]} [deps.backoffMs]
 * @param {number}   [deps.giveUpTries]
 * @param {(event: object, token: string, outcome: { state: string, code?: string }) => void} [deps.onResult]
 *   hears each phone's outcome of a send: `sent`; `off` (its settings turned the
 *   event off); `retrying` or `failed`, with the sender's code (failed: for good, or
 *   given up); `removed` (the push service named the subscription gone, so it is pruned)
 * @returns {{ wake: () => void, idle: () => Promise<void>, stalled: () => ({ since: number, code: string } | null) }}
 */
export function createPushSender({
  outbox,
  store,
  channels,
  logger = defaultLog,
  sleep = unrefSleep,
  now = () => Date.now(),
  backoffMs = RETRY_BACKOFF_MS,
  giveUpTries = GIVE_UP_TRIES,
  onResult = () => {},
}) {
  const tokenStore = typeof store === 'function' ? store : () => store;
  /** @type {Map<string, {failures: number, until: number}>} each phone Google failed, and until when it waits */
  const waitingPhones = new Map();
  let allPhonesFailures = 0; // rounds in a row a failure for every phone stopped
  /** @type {{ since: number, code: string } | null} since when a failure for every phone has stopped each round */
  let stall = null;
  /** Tell onResult, which must never stop a round. */
  const tell = (event, token, outcome) => {
    try {
      onResult(event, token, outcome);
    } catch (err) {
      logger.warn({ err }, 'push result listener threw');
    }
  };
  /** Keep a phone's failed send in the token store (#320); never stops a round. */
  const recordFailure = (tokens, token, code) => {
    try {
      tokens.recordFailure?.(token, code);
    } catch (err) {
      logger.warn({ err }, 'failed to record a failed push');
    }
  };
  let draining = false;
  let drained = Promise.resolve();
  let cutShort = null; // ends a wait new events may cut short

  const backoff = (failures) => backoffMs[Math.min(failures, backoffMs.length) - 1];
  const waits = (token, at) => (waitingPhones.get(token)?.until ?? 0) > at;

  /** Send `entry`'s event to one phone. Never throws. */
  async function sendOne(entry, token) {
    entry.sending = true;
    try {
      return (await channels.sendToToken(token, entry.event)) ?? {};
    } catch (err) {
      logger.warn({ err }, 'push send threw');
      return { ok: false, prune: false, retry: true, allPhones: false, error: 'thrown' };
    } finally {
      entry.sending = false;
    }
  }

  /** Google failed `entry` for this phone only: it waits, or is given up on for it. */
  function phoneFailed(entry, token, code) {
    entry.tries ??= new Map();
    const tries = (entry.tries.get(token) ?? 0) + 1;
    entry.tries.set(token, tries);
    if (tries >= giveUpTries && entry.sent) {
      entry.done.add(token);
      waitingPhones.delete(token);
      logger.warn(
        { ...named(entry.event), token: shortToken(token), tries, code },
        'push given up for one phone'
      );
      tell(entry.event, token, { state: 'failed', code });
      return;
    }
    tell(entry.event, token, { state: 'retrying', code });
    const wait = waitingPhones.get(token) ?? { failures: 0, until: 0 };
    wait.failures += 1;
    wait.until = now() + backoff(wait.failures);
    waitingPhones.set(token, wait);
    logger.warn(
      {
        ...named(entry.event),
        token: shortToken(token),
        code,
        tries,
        retryInSec: backoff(wait.failures) / 1000,
      },
      'push not sent to one phone, trying again later'
    );
  }

  /**
   * One round over the outbox, oldest event first. Returns null, or what a
   * failure every phone would share stopped it on: { code, entry }.
   */
  async function round() {
    const taken = []; // entries a phone took for the first time this round
    let finished = false; // an entry left the outbox this round
    try {
      for (const entry of outbox.entries()) {
        if (!outbox.has(entry)) continue; // collapsed or dropped meanwhile
        const tokens = tokenStore();
        const phones = tokens.getAllTokens().map(({ token }) => token);
        const tally = (entry.tally ??= { sent: 0, suppressed: 0, pruned: 0 });
        const delivered = new Set();
        const toPrune = new Set();
        let stop = null;
        const only = typeof entry.event.device === 'string' ? entry.event.device : null;
        for (const token of phones) {
          if (entry.done.has(token)) continue;
          // An event for one phone: the others are done with it, sent nothing.
          if (only !== null && deviceIdOf(token) !== only) {
            entry.done.add(token);
            continue;
          }
          if (waits(token, now())) continue;
          if (!outbox.has(entry)) break;
          if (!shouldDeliver(entry.event, tokens.getPrefs(token))) {
            entry.done.add(token);
            tally.suppressed += 1;
            tell(entry.event, token, { state: 'off' });
            continue;
          }
          const result = await sendOne(entry, token);
          if (result.retry && result.allPhones) {
            stop = { code: result.error ?? 'unknown', entry };
            break;
          }
          const code = result.error ?? 'unknown';
          if (result.retry) {
            recordFailure(tokens, token, code);
            phoneFailed(entry, token, code);
            continue;
          }
          entry.done.add(token);
          waitingPhones.delete(token);
          if (result.ok) {
            delivered.add(token);
            tally.sent += 1;
            tell(entry.event, token, { state: 'sent' });
            if (!entry.sent) {
              entry.sent = true;
              taken.push(entry);
            }
          } else if (result.prune) {
            toPrune.add(token);
            tell(entry.event, token, { state: 'removed', code });
          } else {
            recordFailure(tokens, token, code);
            tell(entry.event, token, { state: 'failed', code });
          }
        }
        settleTokens(delivered, toPrune, { store: tokens, logger });
        tally.pruned += toPrune.size;
        if (stop) return stop;
        if (outbox.has(entry) && phones.every((token) => entry.done.has(token))) {
          outbox.complete(entry);
          finished = true;
          logger.info(
            { ...named(entry.event), ...tally, queued: outbox.outbox().length },
            'push dispatched'
          );
        }
      }
      return null;
    } finally {
      // One write for the round: the events it finished off the outbox, and a
      // page a phone took and others are still owed on disk, so a restart
      // never drops it with its recovery.
      if (finished || taken.length > 0) outbox.save();
    }
  }

  /**
   * 0 when a round now would send or finish something; else how long until the
   * first waiting phone may be tried; null when nothing is left to do.
   */
  function nextRound() {
    const at = now();
    const phones = tokenStore()
      .getAllTokens()
      .map(({ token }) => token);
    let soonest = null;
    for (const entry of outbox.entries()) {
      const owed = phones.filter((token) => !entry.done.has(token));
      if (owed.length === 0) return 0;
      for (const token of owed) {
        if (!waits(token, at)) return 0;
        const { until } = /** @type {{until: number}} */ (waitingPhones.get(token));
        soonest = soonest === null ? until : Math.min(soonest, until);
      }
    }
    return soonest === null ? null : soonest - at;
  }

  /** A wait new events cut short (wake). */
  function pause(ms) {
    return new Promise((resolve) => {
      cutShort = resolve;
      sleep(ms).then(resolve);
    }).finally(() => {
      cutShort = null;
    });
  }

  async function drain() {
    try {
      while (outbox.head() !== null) {
        let stopped;
        try {
          stopped = await round();
        } catch (err) {
          // The token store failed: wait, as for Google.
          logger.error({ err }, 'push send error');
          stopped = { code: 'error', entry: outbox.head() };
        }
        if (stopped) {
          allPhonesFailures += 1;
          stall = { since: stall?.since ?? now(), code: stopped.code };
          const wait = backoff(allPhonesFailures);
          logger.warn(
            {
              ...(stopped.entry ? named(stopped.entry.event) : {}),
              code: stopped.code,
              tries: allPhonesFailures,
              retryInSec: wait / 1000,
              queued: outbox.outbox().length,
            },
            'push not sent, trying again later'
          );
          await sleep(wait); // new events don't cut this short: Google fails them all alike
          continue;
        }
        allPhonesFailures = 0;
        stall = null;
        const next = nextRound();
        if (next === null) break;
        if (next > 0) await pause(next);
      }
    } catch (err) {
      // Never seen: the outbox stays, and the next cycle wakes the sender again.
      logger.error({ err }, 'push sender error');
    } finally {
      draining = false;
    }
  }

  return {
    /** Start sending what the outbox holds; while a phone's wait runs, cut it short for the others. */
    wake() {
      if (draining) {
        cutShort?.();
        return;
      }
      draining = true;
      drained = drain();
    },
    /** Settles when the drain running now (if any) has emptied the outbox. */
    idle() {
      return drained;
    },
    /**
     * A failure every phone would share that stops each round (Google out of
     * reach, the key refused), since when and the sender's code; null once a round
     * gets through, or before any failed so (#320).
     */
    stalled() {
      return stall ? { ...stall } : null;
    },
  };
}
