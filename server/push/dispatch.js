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

/**
 * Each recovery type and the page types whose episode it ends: what the
 * outbox collapses, and never drops (#579).
 */
const EPISODE_PAGES = Object.freeze({
  service_recovered: ['service_down'],
  host_recovered: ['host_unreachable'],
  host_threshold_cleared: ['host_threshold'],
  ups_restored: ['ups_on_battery'],
  cron_recovered: ['cron_failed', 'cron_overdue'],
  source_recovered: ['source_down'],
});
const RECOVERY_OF = new Map(
  Object.entries(EPISODE_PAGES).flatMap(([recovery, pages]) => pages.map((page) => [page, recovery]))
);
/**
 * The `prev` states of a page that carries on an episode a page already
 * opened: a reading from warn to crit, a job from overdue to failed.
 */
const PAGED_STATES = new Set(['down', 'warn', 'crit', 'on_battery', 'failure', 'overdue']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** An event as the differ makes it: enough of one to send (fcm.js buildMessage). */
const isEvent = (v) => isObject(v) && typeof v.type === 'string' && typeof v.id === 'string';
const named = (event) => `${event.type} ${event.id}`;
const isRecovery = (event) => Object.hasOwn(EPISODE_PAGES, event.type);
/** The episode an event is part of, its recovery type and id; null for none. */
const episodeOf = (event) => {
  const recovery = isRecovery(event) ? event.type : RECOVERY_OF.get(event.type);
  return recovery ? `${recovery} ${event.id}` : null;
};
const opensEpisode = (event) => !PAGED_STATES.has(event.prev);

/**
 * The previous cycle's snapshot, which the next cycle diffs against, and the
 * outbox: the events diffed but not yet sent to every phone (#579). Both live
 * in memory; the file at `path` is for restarts: read on first use, so a
 * restart diffs against the last persisted state (no re-alert, no missed
 * change) and sends what was still queued. The snapshot holds states and
 * levels, not readings (#292), so a steady board costs no write, and the status
 * model is seeded with the file's levels at boot (#361), so a restart keeps
 * every episode.
 *
 * One file, one atomic write: the snapshot's fields, and `outbox`, the events
 * in order, while any are queued (with none the file is as it was before #579,
 * and an older JagHelm reads it as its own). Each queued event keeps when it
 * was queued (`queuedAt`, for /api/health) and whether a phone has taken it
 * (`sent`). `advance(snap, events)` moves the snapshot and queues its events
 * in that one write, before anything is sent. So a crash before the write
 * leaves the last snapshot, and the restart diffs the change again and pages
 * once; a crash after it leaves the events queued and the snapshot moved, so
 * the restart sends them and diffs nothing again. Two files could not do that:
 * whichever was written first, a crash between them would drop the events or
 * send them twice. The file is rewritten when the alert state (alertStateKey)
 * or the outbox changes: a page queued, taken, sent or dropped.
 *
 * A recovery whose episode no phone has seen (its pages all still queued and
 * none taken, or dropped untaken) takes those pages with it: neither is sent.
 * Past `cap` events the oldest pages not being sent are dropped, with one warn
 * line naming each (OUTBOX_CAP). A recovery never is: its page went out, and
 * without it the phone would show the problem forever. So recoveries can hold
 * the outbox over its cap, one per entity whose page went out at most.
 *
 * A failed write is logged and retried on the next change and every cycle
 * until it lands. Memory moves on regardless, so the running process neither
 * sends an alert twice nor holds one back. Until the write lands, a restart
 * reads the older file: it can re-send an alert, miss the recovery of one
 * already sent, or lose pages that were still queued. flush() writes the file
 * on shutdown if it is behind; the outbox needs nothing more, as it is on disk
 * with each change.
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
 * @param {() => number} [opts.now]  the clock that stamps `queuedAt`
 * @param {object}   [opts.logger]
 */
export function createPushSnapshot({
  path,
  write = atomicWriteFileSync,
  upgrade = (snap) => snap,
  cap = OUTBOX_CAP,
  now = () => Date.now(),
  logger = defaultLog,
}) {
  let loaded = false;
  let prev = null; // the last cycle's snapshot (null: none yet)
  /**
   * The outbox, oldest first. `done`: the phones done with it (the sender's,
   * in memory); `sending` while a send of it is in flight.
   * @type {Array<{event: object, queuedAt: number, sent: boolean, done: Set<string>, sending?: boolean}>}
   */
  const queue = [];
  // Episodes whose opening page the cap dropped before any phone took it: their
  // recovery is not sent either. In memory only.
  const droppedUnseen = new Set();
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
      if (Array.isArray(outbox)) {
        for (const item of outbox) {
          if (!isObject(item) || !isEvent(item.event)) continue;
          const queuedAt = Number.isFinite(item.queuedAt) ? item.queuedAt : now();
          queue.push({ event: item.event, queuedAt, sent: item.sent === true, done: new Set() });
        }
        trim();
      }
    }
    prev = upgrade(snap);
    filedKey = alertStateKey(prev);
  }

  /** Queue `events` behind the outbox, collapsing and dropping as above. */
  function enqueue(events) {
    const queuedAt = now();
    for (const event of events) {
      const episode = episodeOf(event);
      if (episode !== null && isRecovery(event)) {
        if (collapse(episode, event)) continue;
      } else if (episode !== null && opensEpisode(event)) {
        droppedUnseen.delete(episode); // a new episode
      }
      queue.push({ event, queuedAt, sent: false, done: new Set() });
    }
    trim();
  }

  /** Whether `recovery` ends an episode no phone has seen: then it and the episode's queued pages go. */
  function collapse(episode, recovery) {
    const unseen = droppedUnseen.delete(episode);
    let from = 0; // the episode's pages are those after its last queued recovery
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (isRecovery(queue[i].event) && episodeOf(queue[i].event) === episode) {
        from = i + 1;
        break;
      }
    }
    const pages = queue.slice(from).filter((e) => episodeOf(e.event) === episode);
    if (pages.length === 0 ? !unseen : pages.some((e) => e.sent || e.sending)) return false;
    if (pages.length > 0 && !unseen && !opensEpisode(pages[0].event)) return false;
    for (const e of pages) queue.splice(queue.indexOf(e), 1);
    logger.info(
      { dropped: [...pages.map((e) => named(e.event)), named(recovery)] },
      'push page and its recovery both unsent: neither is sent'
    );
    return true;
  }

  /** Past the cap, drop the oldest pages no send is in flight for. */
  function trim() {
    let over = queue.length - cap;
    const dropped = [];
    for (let i = 0; over > 0 && i < queue.length; ) {
      const e = queue[i];
      if (e.sending || isRecovery(e.event)) {
        i += 1;
        continue;
      }
      queue.splice(i, 1);
      dropped.push(named(e.event));
      over -= 1;
      const episode = episodeOf(e.event);
      if (episode !== null && !e.sent && opensEpisode(e.event)) droppedUnseen.add(episode);
    }
    if (dropped.length > 0) {
      logger.warn({ cap, dropped }, 'push outbox full: dropped the oldest unsent pushes');
    }
  }

  function persist() {
    const snap = prev ?? {};
    const outbox = queue.map((e) => ({
      queuedAt: e.queuedAt,
      event: e.event,
      ...(e.sent ? { sent: true } : {}),
    }));
    const file = outbox.length > 0 ? { ...snap, outbox } : snap;
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
      if (events.length > 0) {
        enqueue(events);
        behind = true;
      }
      if (behind || filedKey === null || filedKey !== alertStateKey(snap)) persist();
    },
    /** The queued events, oldest first. */
    outbox() {
      load();
      return queue.map((e) => e.event);
    },
    /** The queued entries ({ event, queuedAt, sent, done }), oldest first: a copy of the list. */
    entries() {
      load();
      return [...queue];
    },
    /** The oldest queued entry, or null. */
    head() {
      load();
      return queue[0] ?? null;
    },
    /** Whether `entry` is still queued (not sent, collapsed or dropped since). */
    has(entry) {
      return queue.includes(entry);
    },
    /** When the oldest queued event was queued (ms), or null with none. */
    oldestQueuedAt() {
      load();
      return queue.length > 0 ? Math.min(...queue.map((e) => e.queuedAt)) : null;
    },
    /** Take `entry` off the outbox: done with by every phone. */
    complete(entry) {
      const i = queue.indexOf(entry);
      if (i === -1) return;
      queue.splice(i, 1);
      persist();
    },
    /** Write the file now: a queued event's `sent` changed. */
    save() {
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
