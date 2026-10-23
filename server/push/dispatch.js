/**
 * Push dispatch: the pure pref-filter (shouldDeliver/categoryOf), the
 * fan-out the Arcane poller awaits (dispatchEvents), the prev-snapshot memory
 * and the outbox (createPushSnapshot) and the per-cycle orchestrator
 * (runPushCycle), which queues the refresh loop's events for the sender
 * (push/outbox.js, #579) and never sends itself.
 *
 * shouldDeliver + categoryOf are PURE and clock-free (determinism law).
 * dispatchEvents, createPushSnapshot and runPushCycle own the I/O (fcm.send,
 * snapshot file) and are the only places a clock or side effect lives.
 */
import { existsSync, readFileSync } from 'fs';

import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { createLogger } from '../util/logger.js';
import { alertStateKey, CONFIG_SOURCE, diffSnapshots, RECOVERY_TYPES, STATUS_CHECK } from './differ.js';

const defaultLog = createLogger('push-dispatch');

// DEFAULT_PREFS has a single owner: server/push/tokenStore.js. shouldDeliver
// receives already-resolved prefs, so dispatch.js does not redefine it.

/**
 * Explicit type -> pref-category overrides. The Arcane events (updates and the
 * weekly vulnerability digest) share the existing `watchtower` (updates) pref
 * key: the installed Android app has a strict 5-key prefs shape, so no new key
 * is added.
 */
export const TYPE_CATEGORY = Object.freeze({
  arcane_update: 'watchtower',
  arcane_heldback: 'watchtower',
  arcane_cleared: 'watchtower',
  arcane_agent_offline: 'watchtower',
  arcane_agent_recovered: 'watchtower',
  arcane_release: 'watchtower',
  arcane_vulns: 'watchtower',
});

/**
 * A monitoring source that is down pages in the category of what it watches
 * (#292): Prometheus the hosts, Kuma the services, the NUT exporter the UPS.
 * The installed Android app has a strict 5-key prefs shape, so the source
 * events get no category of their own.
 */
export const SOURCE_CATEGORY = Object.freeze({ prometheus: 'host', kuma: 'service', nut: 'ups' });
const SOURCE_TYPES = new Set(['source_down', 'source_recovered']);

/**
 * Map an event (its type, and for a source event its id) to its preference
 * category. null for the status check's events (#440): while the status model
 * fails no category pages, so its push belongs to all of them, and no
 * category switch turns it off. null for services.yaml's too (#505): a file
 * that doesn't parse is every category's problem (nothing changed in it
 * reaches the board), so no category switch turns it off either.
 */
export function categoryOf(type, id) {
  if (Object.hasOwn(TYPE_CATEGORY, type)) return TYPE_CATEGORY[type];
  if (SOURCE_TYPES.has(type)) {
    if (id === STATUS_CHECK || id === CONFIG_SOURCE) return null;
    return Object.hasOwn(SOURCE_CATEGORY, id) ? SOURCE_CATEGORY[id] : 'host';
  }
  return type.split('_')[0];
}

/**
 * Pure pref filter. Returns true iff this event should be delivered under
 * the given per-token prefs. No clock, no I/O.
 */
export function shouldDeliver(event, prefs) {
  if (!prefs.enabled) return false;
  const category = categoryOf(event.type, event.id);
  if (category !== null && prefs.categories[category] === false) return false;
  if (RECOVERY_TYPES.has(event.type) && !prefs.notifyRecoveries) return false;
  return true;
}

/**
 * Fan a list of events across every registered token, honoring each token's
 * prefs. A token whose send asks to be pruned (dead/invalid registration) is
 * removed exactly once at the end. Tokens FCM accepted a send for (and that are
 * not being pruned) are marked delivered in one batch, which keeps a phone that
 * only receives alerts from aging out of the store (#247). Returns counts.
 *
 * @param {Array} events  events from diffSnapshots (already canonically sorted)
 * @param {object} deps   { store, fcm, logger }
 * @returns {Promise<{sent:number, suppressed:number, pruned:number}>}
 */
export async function dispatchEvents(events, { store, fcm, logger = defaultLog }) {
  let sent = 0;
  let suppressed = 0;
  const toPrune = new Set();
  const delivered = new Set();

  // Build a single prefs map before iterating events — prefs don't change
  // mid-dispatch, so calling store.getPrefs() once per token (not per event×token)
  // is equivalent and avoids O(events × tokens) redundant lookups.
  const tokens = store.getAllTokens();
  const prefsMap = new Map(tokens.map(({ token }) => [token, store.getPrefs(token)]));

  for (const event of events) {
    for (const { token } of tokens) {
      const prefs = prefsMap.get(token);
      if (!shouldDeliver(event, prefs)) {
        suppressed += 1;
        continue;
      }
      const result = await fcm.sendToToken(token, event);
      sent += 1;
      if (result && result.prune) toPrune.add(token);
      else if (result && result.ok) delivered.add(token);
    }
  }

  settleTokens(delivered, toPrune, { store, logger });
  return { sent, suppressed, pruned: toPrune.size };
}

/**
 * After sends: mark the tokens FCM accepted a send for delivered, in one batch
 * (#247), and remove the ones it named dead, once each. A token in both is
 * only removed. Shared by dispatchEvents and the outbox's sender.
 *
 * @param {Set<string>} delivered
 * @param {Set<string>} toPrune
 * @param {{ store: object, logger: object }} deps
 */
export function settleTokens(delivered, toPrune, { store, logger }) {
  const accepted = [...delivered].filter((token) => !toPrune.has(token));
  if (accepted.length > 0) {
    try {
      store.markDelivered(accepted);
    } catch (err) {
      logger.warn({ err }, 'failed to record push deliveries');
    }
  }

  for (const token of toPrune) {
    try {
      store.removeToken(token);
    } catch (err) {
      logger.warn({ err }, 'failed to prune dead push token');
    }
  }
}

/**
 * The most pushes the outbox holds (#579). A cycle rarely has more than a few
 * events and a whole-homelab outage a few dozen, so 100 holds hours of an
 * internet outage's changes; past it, an hour-old page is worth less than the
 * newest, and phones that come back to more than 100 notifications at once are
 * not helped. An event is a few hundred bytes, so the file stays under ~50 KB.
 */
export const OUTBOX_CAP = 100;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** An event as the differ makes it: enough of one to send (fcm.js buildMessage). */
const isEvent = (v) => isObject(v) && typeof v.type === 'string' && typeof v.id === 'string';
const named = (event) => `${event.type} ${event.id}`;

/**
 * The previous cycle's snapshot, which the next cycle diffs against, and the
 * outbox: the events diffed but not yet sent (#579). Both live in memory; the
 * file at `path` is for restarts: read on first use, so a restart diffs against
 * the last persisted state (no re-alert, no missed change) and sends what was
 * still queued. The snapshot holds states and levels, not readings (#292), so a
 * steady board costs no write, and the status model is seeded with the file's
 * levels at boot (#361), so a restart keeps every episode.
 *
 * One file, one atomic write: the snapshot's fields, and `outbox`, the events
 * in order, while any are queued (with none the file is as it was before #579,
 * and an older JagHelm reads it as its own). `advance(snap, events)` moves the
 * snapshot and queues its events in that one write, before anything is sent.
 * So a crash before the write leaves the last snapshot, and the restart diffs
 * the change again and pages once; a crash after it leaves the events queued
 * and the snapshot moved, so the restart sends them and diffs nothing again.
 * Two files could not do that: whichever was written first, a crash between
 * them would drop the events or send them twice. The file is rewritten when the
 * alert state (alertStateKey) or the outbox changes: a page queued, sent or
 * dropped.
 *
 * A failed write is logged and retried on the next change and every cycle
 * until it lands. Memory moves on regardless, so the running process neither
 * sends an alert twice nor holds one back. Until the write lands, a restart
 * reads the older file: it can re-send an alert, miss the recovery of one
 * already sent, or lose pages that were still queued. flush() writes
 * the file on shutdown if it is behind; the outbox needs nothing more, as it
 * is on disk with each change.
 *
 * Past `cap` events the oldest not being sent is dropped, with one warn line
 * naming each (OUTBOX_CAP).
 *
 * `upgrade` brings a file an older version wrote to this one's shape as it is
 * read (refresh.js: push/snapshot.js upgradeSnapshot, levels for a pre-#292
 * file's readings), so the first cycle diffs like any other.
 *
 * @param {object}   opts
 * @param {string}   opts.path       the persisted snapshot file
 * @param {Function} [opts.write]    atomic writer (injected in tests)
 * @param {Function} [opts.upgrade]  (snapshot) => snapshot, applied to what the file holds
 * @param {number}   [opts.cap]      the most events the outbox holds
 * @param {object}   [opts.logger]
 */
export function createPushSnapshot({
  path,
  write = atomicWriteFileSync,
  upgrade = (snap) => snap,
  cap = OUTBOX_CAP,
  logger = defaultLog,
}) {
  let loaded = false;
  let prev = null; // the last cycle's snapshot (null: none yet)
  /** @type {Array<{event: object, done: Set<string>, sending?: boolean}>} the outbox, oldest first */
  const queue = [];
  let filedKey = null; // alertStateKey of the snapshot the file holds (null: nothing usable)
  let behind = false; // the file is behind memory: a write failed, or the outbox changed

  function read() {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      // Corrupt/partial snapshot => no previous state rather than a crash.
      logger.warn({ err }, 'unreadable push snapshot, starting with no previous state');
      return null;
    }
  }

  function load() {
    if (loaded) return;
    loaded = true;
    const file = read();
    if (file === null) return;
    let snap = file;
    if (isObject(file) && Object.hasOwn(file, 'outbox')) {
      const { outbox, ...rest } = file;
      snap = rest;
      if (Array.isArray(outbox)) enqueue(outbox.filter(isEvent));
    }
    prev = upgrade(snap);
    filedKey = alertStateKey(prev);
  }

  /** Queue `events` behind the outbox, dropping the oldest past the cap. Returns whether any were queued. */
  function enqueue(events) {
    for (const event of events) queue.push({ event, done: new Set() });
    const over = queue.length - cap;
    if (over > 0) {
      const from = queue[0].sending ? 1 : 0; // the one being sent goes on
      const dropped = queue.splice(from, over);
      logger.warn(
        { cap, dropped: dropped.map((e) => named(e.event)) },
        'push outbox full: dropped the oldest unsent pushes'
      );
    }
    return events.length > 0;
  }

  function persist() {
    const snap = prev ?? {};
    const file = queue.length > 0 ? { ...snap, outbox: queue.map((e) => e.event) } : snap;
    try {
      write(path, JSON.stringify(file));
      filedKey = alertStateKey(snap);
      behind = false;
    } catch (err) {
      behind = true;
      logger.error({ err }, 'failed to persist push snapshot, retrying next cycle');
    }
  }

  return {
    /** The previous cycle's snapshot, or null when there is none (no file, or an unreadable one). */
    prev() {
      load();
      return prev;
    },
    /**
     * Make `snap` the next cycle's prev and queue `events` behind the outbox,
     * in one write when the file is behind.
     */
    advance(snap, events = []) {
      load();
      prev = snap;
      if (enqueue(events)) behind = true;
      if (behind || filedKey === null || filedKey !== alertStateKey(snap)) persist();
    },
    /** The queued events, oldest first. */
    outbox() {
      load();
      return queue.map((e) => e.event);
    },
    /** The oldest queued entry ({ event, done: tokens it is done with }), or null. */
    head() {
      load();
      return queue[0] ?? null;
    },
    /** Take `entry` off the outbox: sent, or failed for good. */
    complete(entry) {
      const i = queue.indexOf(entry);
      if (i === -1) return;
      queue.splice(i, 1);
      persist();
    },
    /** Write the file if it is behind memory (shutdown). */
    flush() {
      if (prev === null || !behind) return;
      persist();
    },
  };
}

/**
 * One push cycle: build the current snapshot, diff it against the previous
 * one, and advance to it with the resulting events queued in the outbox, in
 * one write (createPushSnapshot), then wake the sender (push/outbox.js), which
 * sends them in order. The cycle never waits on a send (#579): with Google
 * out of reach a send can take minutes, and the refresh loop, so /api/health
 * and the board, would wait with it. The next cycle diffs against the advanced
 * snapshot, so it never makes again what is queued. With no previous snapshot,
 * every entity is new to it (diffSnapshots, #448): each open problem pages
 * once, on this cycle, and the snapshot advanced to holds it from then on.
 * That is so whatever the sources say (#461): a source failing then is in the
 * snapshot like any other cycle's, and pages after its usual 2 cycles.
 *
 * The builder is handed the previous snapshot, so what the status model can't
 * call, and the parts fed by a source that failed this cycle, can be kept from
 * it (buildSnapshot, #232, #292). Advancing to that snapshot keeps them for the
 * next cycle too, however long the failure. `status` is the model the snapshot
 * was built from: each event takes its words from it.
 * A builder that returns null has no snapshot to give: the cycle is skipped,
 * and nothing is diffed, queued or advanced. The loop's builder always gives
 * one (push/snapshot.js cycleSnapshot): for a cycle whose status model threw,
 * the previous snapshot with the status check's failed cycle counted (#440),
 * so a model that keeps throwing pages once instead of silencing push.
 *
 * Total error isolation: the entire body is wrapped so it can NEVER reject.
 * It runs inside the background refresh loop and must never break that loop.
 * A cycle that throws before it advances leaves prev and the outbox as they
 * were, so the next cycle diffs against them again instead of dropping the
 * alert. Graceful-disable: if push has no FCM creds it returns immediately and
 * does not even read or write the snapshot file, or wake the sender.
 *
 * @param {object} deps
 * @param {Function} deps.buildSnapshotFn  (prev) => Snapshot | null (injected; fakeable)
 * @param {object|null} [deps.status]      the status model of this cycle (the events' words)
 * @param {object}   deps.store            token store
 * @param {object}   deps.fcm              fcm module
 * @param {object}   deps.snapshot         prev snapshot and outbox (createPushSnapshot)
 * @param {object}   deps.sender           the outbox's sender (push/outbox.js createPushSender)
 * @param {object}   [deps.logger]
 * @returns {Promise<void>}
 */
export async function runPushCycle({ buildSnapshotFn, status = null, store, fcm, snapshot, sender, logger = defaultLog }) {
  try {
    store.pruneStale();
    if (!fcm.isPushEnabled()) return;

    const prev = snapshot.prev();
    try {
      const snap = buildSnapshotFn(prev);
      if (snap === null) {
        logger.debug('push cycle skipped: no snapshot this cycle');
        return;
      }

      // With no prev (no file, or an unreadable one) every entity is new: what
      // is in trouble pages once, what is ok sends nothing (#448).
      const events = diffSnapshots(prev, snap, status);
      snapshot.advance(snap, events);
      if (events.length > 0) {
        logger.info({ events: events.length, queued: snapshot.outbox().length }, 'push cycle queued');
      }
    } finally {
      // Also when nothing was queued: a restart's outbox is sent from its first cycle.
      sender.wake();
    }
  } catch (err) {
    // Swallow EVERYTHING. This runs inside the refresh loop; it must never
    // reject or the loop's allSettled accounting / health gate could be hurt.
    logger.error({ err }, 'push cycle error (swallowed)');
  }
}
