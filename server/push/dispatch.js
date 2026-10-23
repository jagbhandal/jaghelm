/**
 * Push dispatch: the pure pref-filter (shouldDeliver/categoryOf), the
 * prev-snapshot memory, the outbox and the alert history (createPushSnapshot)
 * and the per-cycle orchestrator (runPushCycle), which records the refresh
 * loop's events (#267), queues them for the sender (push/outbox.js, #579) and
 * never sends itself. The Arcane poller and the weekly vulnerability digest
 * hand theirs to the same snapshot (notify, #581): one outbox, one history.
 *
 * shouldDeliver + categoryOf are PURE and clock-free (determinism law).
 * createPushSnapshot and runPushCycle own the I/O (the snapshot file) and are
 * the only places a clock or side effect lives.
 */
import { chmodSync, existsSync, readdirSync, readFileSync, renameSync, unlinkSync } from 'fs';
import { basename, dirname, join } from 'path';

import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { createLogger } from '../util/logger.js';
import { jsonFileErrorFields } from '../util/parseError.js';
import { createAlertHistory, HISTORY_CAP, HISTORY_MAX_AGE_MS, pushOutcome } from './alertHistory.js';
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
 * After sends: mark the tokens FCM accepted a send for delivered, in one batch
 * (#247), and remove the ones it named dead, once each. A token in both is
 * only removed. The outbox's sender calls it after each event (push/outbox.js).
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
 * outbox collapses, and never drops (#579). An Arcane agent's too (#581);
 * Arcane's updates and digests are news, not episodes, and never collapse.
 */
const EPISODE_PAGES = Object.freeze({
  service_recovered: ['service_down'],
  host_recovered: ['host_unreachable'],
  host_threshold_cleared: ['host_threshold'],
  ups_restored: ['ups_on_battery'],
  cron_recovered: ['cron_failed', 'cron_overdue'],
  source_recovered: ['source_down'],
  arcane_agent_recovered: ['arcane_agent_offline'],
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
 * The snapshots the next cycle diffs against, the outbox: the events diffed
 * but not yet sent to every phone (#579), and the alert history: every change,
 * for 30 days (#267, push/alertHistory.js). Two baselines:
 *  - push's (`prev`), which moves only while push is on, as before #267: push
 *    pages against what the phones were last told, so a cycle with push off
 *    never changes what is sent once it is back (a page queued then isn't sent
 *    stale over its recovery, and an outage that opened meanwhile pages);
 *  - the history's (`historyPrev`), which moves every cycle, push on or off:
 *    each cycle's changes against it are recorded. While push is on the two
 *    are the same snapshot, so the history is what was paged, each once.
 * All live in memory; the file at `path` is for restarts: read on first use,
 * so a restart diffs against the last persisted state (no re-alert, no missed
 * change), sends what was still queued and serves the history. The snapshots
 * hold states and levels, not readings (#292), so a steady board costs no
 * write, and the status model is seeded with the history baseline's levels at
 * boot (#361), so a restart keeps every episode.
 *
 * One file, one atomic write: push's snapshot's fields; `outbox`, the events
 * in order, while any are queued; and `history` once an event was ever
 * recorded or the history's baseline differs from push's: `{ lastId, events,
 * snapshot? }`, `snapshot` the history's baseline, only while it differs
 * (with push off). With neither the file is as it was before #579, and an
 * older JagHelm reads it as its own; one from before #267 keeps the outbox and
 * drops `history` at its first write after a change of state. Each queued
 * event keeps when it was queued (`queuedAt`, for /api/health), whether a
 * phone has taken it (`sent`) and its record's id (`historyId`).
 * `commit({ history, push })` moves both baselines, records the history's
 * events and queues push's, in that one write, before anything is sent. So a
 * crash before the write leaves the last snapshots, and the restart diffs the
 * change again, records it and pages once; a crash after it leaves the events
 * recorded and queued and the snapshots moved, so the restart sends them and
 * diffs nothing again. Two files could not do that: whichever was written
 * first, a crash between them would drop the events or send or record them
 * twice. The file is rewritten when either baseline's alert state
 * (alertStateKey), the history or the outbox changes: an event recorded, a
 * page queued or taken, or a sender round that sent or dropped some (what push
 * did with each noted in its record in the same write).
 *
 * The same write carries, under `producers`, the state of each producer
 * other than the refresh loop (#581): the Arcane poller's (`arcane`) and the
 * weekly vulnerability digest's (`arcane-vulns`), what each has already
 * notified. `notify(name, state, events)` replaces one's state, records its
 * events and queues them, all in one write, so its "already notified" moves
 * with its pushes: a crash before the write leaves its old state, and it
 * finds the same news again and queues it once; a crash after it leaves the
 * pushes queued with the state that made them, and nothing is found twice.
 * With push off its events are recorded `off`, queued nowhere, and its state
 * moves all the same (an Arcane notice is never sent late). The key is written
 * once a producer has state; an older JagHelm takes it for a snapshot field
 * no diff reads.
 *
 * A file that doesn't parse is moved aside (`<path>.corrupt-<time>`, 0600,
 * the newest only) before anything can write over it, with one warn line
 * counting what it held, never quoting it (#504); JagHelm starts with no
 * snapshot, outbox, history or producer state (unreadable() says so).
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
 * @param {() => number} [opts.now]  the clock that stamps `queuedAt` and each record's `at`
 * @param {number}   [opts.historyCap]       the most events the history keeps (HISTORY_CAP)
 * @param {number}   [opts.historyMaxAgeMs]  how long it keeps one (HISTORY_MAX_AGE_MS)
 * @param {object}   [opts.logger]
 */
export function createPushSnapshot({
  path,
  write = atomicWriteFileSync,
  upgrade = (snap) => snap,
  cap = OUTBOX_CAP,
  now = () => Date.now(),
  historyCap = HISTORY_CAP,
  historyMaxAgeMs = HISTORY_MAX_AGE_MS,
  logger = defaultLog,
}) {
  const history = createAlertHistory({ now, cap: historyCap, maxAgeMs: historyMaxAgeMs, logger });
  let loaded = false;
  let prev = null; // push's baseline: the snapshot of its last cycle (null: none yet)
  let historyPrev = null; // the history's baseline: the last cycle's, push on or off (null: none yet)
  /**
   * The outbox, oldest first. `done`: the phones done with it (the sender's,
   * in memory); `sending` while a send of it is in flight; `historyId` its
   * record in the history; `tally` the sender's count of what each phone did.
   * @type {Array<{event: object, queuedAt: number, sent: boolean, done: Set<string>, sending?: boolean, historyId?: string, tally?: {sent: number, suppressed: number}}>}
   */
  const queue = [];
  // Episodes whose opening page the cap dropped before any phone took it: their
  // recovery is not sent either. In memory only.
  const droppedUnseen = new Set();
  let filedKey = null; // alertStateKey of push's snapshot the file holds (null: nothing usable)
  let filedHistoryKey = null; // and of the history's baseline
  let behind = false; // the file is behind memory: a write failed, or the outbox changed
  /** Each producer's state (#581) by name, as the file holds it: notify's copies. */
  const producers = new Map();
  let lost = false; // the file was there at load but couldn't be read or parsed

  function read() {
    if (!existsSync(path)) return null;
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (err) {
      // Can't be read (its path and code are logged, never its content).
      lost = true;
      logger.warn(jsonFileErrorFields(err), 'unreadable push snapshot, starting with no previous state');
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      lost = true;
      setAside(text, err);
      return null;
    }
  }

  /**
   * A file that doesn't parse: moved aside, so the next write can't destroy
   * what is left of it (30 days of history, the queued pushes), readable by
   * JagHelm's user only, keeping the newest such file. One warn line with the
   * parse error's reason and position and what it held, counted, never quoted
   * (#504).
   */
  function setAside(text, err) {
    const dir = dirname(path);
    const prefix = `${basename(path)}.corrupt-`;
    const stamp = new Date(now()).toISOString().replace(/\.\d+/, '').replace(/[-:]/g, '');
    const aside = `${prefix}${stamp}`;
    let movedTo = null;
    try {
      renameSync(path, join(dir, aside));
      movedTo = aside;
      chmodSync(join(dir, aside), 0o600);
      for (const name of readdirSync(dir)) {
        if (name.startsWith(prefix) && name !== aside) unlinkSync(join(dir, name));
      }
    } catch (moveErr) {
      logger.error({ err: moveErr }, 'could not move the unreadable push snapshot aside');
    }
    const count = (needle) => text.split(needle).length - 1;
    logger.warn(
      {
        ...jsonFileErrorFields(err),
        movedTo,
        bytes: Buffer.byteLength(text),
        queued: count('"queuedAt":'),
        events: count('"push":{'),
      },
      'unreadable push snapshot moved aside: starting with no snapshot, outbox or history'
    );
  }

  function load() {
    if (loaded) return;
    loaded = true;
    const file = read();
    if (file === null) return;
    let snap = file;
    let recorded;
    if (isObject(file) && ['outbox', 'history', 'producers'].some((key) => Object.hasOwn(file, key))) {
      const { outbox, history: filed, producers: states, ...rest } = file;
      snap = rest;
      recorded = filed;
      history.load(filed);
      if (isObject(states)) {
        for (const [name, state] of Object.entries(states)) if (isObject(state)) producers.set(name, state);
      }
      if (Array.isArray(outbox)) {
        for (const item of outbox) {
          if (!isObject(item) || !isEvent(item.event)) continue;
          const queuedAt = Number.isFinite(item.queuedAt) ? item.queuedAt : now();
          queue.push({
            event: item.event,
            queuedAt,
            sent: item.sent === true,
            done: new Set(),
            ...(typeof item.historyId === 'string' ? { historyId: item.historyId } : {}),
          });
        }
        trim();
      }
    }
    // No snapshot fields: push has never been on (only the history's baseline is kept).
    prev = isObject(snap) && Object.keys(snap).length === 0 ? null : upgrade(snap);
    historyPrev = isObject(recorded) && isObject(recorded.snapshot) ? upgrade(recorded.snapshot) : prev;
    filedKey = alertStateKey(prev);
    filedHistoryKey = alertStateKey(historyPrev);
  }

  /**
   * The history record a page of push's is about: this cycle's record of the
   * same change, or, for a page push makes on coming back on (an outage that
   * opened while it was off), the newest record of it from then. Its record is
   * queued from here.
   */
  function recordOf(event, recorded) {
    const i = recorded.findIndex((r) => r.event.type === event.type && r.event.id === event.id);
    const id = i === -1 ? history.latestOff(event.type, String(event.id)) : recorded.splice(i, 1)[0].id;
    history.settle(id, pushOutcome(undefined, 'pending'));
    return id;
  }

  /** Queue `events` (their records `ids`) behind the outbox, collapsing and dropping as above. */
  function enqueue(events, ids) {
    const queuedAt = now();
    events.forEach((event, i) => {
      const historyId = ids[i];
      const episode = episodeOf(event);
      if (episode !== null && isRecovery(event)) {
        if (collapse(episode, event)) {
          history.settle(historyId, pushOutcome(undefined, 'dropped'));
          return;
        }
      } else if (episode !== null && opensEpisode(event)) {
        droppedUnseen.delete(episode); // a new episode
      }
      queue.push({ event, queuedAt, sent: false, done: new Set(), historyId });
    });
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
    for (const e of pages) {
      queue.splice(queue.indexOf(e), 1);
      history.settle(e.historyId, pushOutcome(undefined, 'dropped'));
    }
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
      history.settle(e.historyId, pushOutcome(e.tally, 'dropped'));
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
      ...(e.historyId ? { historyId: e.historyId } : {}),
    }));
    const recorded = history.toFile();
    // The history's baseline is written only while it differs from push's.
    const own = historyPrev !== null && alertStateKey(historyPrev) !== alertStateKey(prev);
    const kept =
      recorded || own
        ? { ...(recorded ?? { lastId: 0, events: [] }), ...(own ? { snapshot: historyPrev } : {}) }
        : null;
    const file = {
      ...snap,
      ...(outbox.length > 0 ? { outbox } : {}),
      ...(kept ? { history: kept } : {}),
      ...(producers.size > 0 ? { producers: Object.fromEntries(producers) } : {}),
    };
    try {
      write(path, JSON.stringify(file));
      filedKey = alertStateKey(prev);
      filedHistoryKey = alertStateKey(historyPrev);
      behind = false;
    } catch (err) {
      behind = true;
      logger.error({ err }, 'failed to persist push snapshot, retrying next cycle');
    }
  }

  /**
   * One cycle: the history's baseline moves to `h.snap` and its events are
   * recorded (null: no history snapshot this cycle); push's moves to `p.snap`
   * and its events are queued, each tied to its record (null: push is off, or
   * had no snapshot). One write, when the file is behind.
   *
   * @param {{ snap: object, events: object[] } | null} h
   * @param {{ snap: object, events: object[] } | null} p
   */
  function commit(h, p) {
    load();
    /** @type {Array<{event: object, id: string}>} this cycle's records, not yet tied to a page */
    const recorded = [];
    if (h) {
      historyPrev = h.snap;
      if (h.events.length > 0) {
        // With push on, a record no page of push's takes is one push had nothing to send for.
        const ids = history.record(h.events, p ? 'unsent' : 'off');
        h.events.forEach((event, i) => recorded.push({ event, id: ids[i] }));
        behind = true;
      }
    }
    if (p) {
      prev = p.snap;
      if (p.events.length > 0) {
        enqueue(p.events, p.events.map((event) => recordOf(event, recorded)));
        behind = true;
      }
    }
    if (
      behind ||
      filedKey === null ||
      filedKey !== alertStateKey(prev) ||
      filedHistoryKey !== alertStateKey(historyPrev)
    ) {
      persist();
    }
  }

  return {
    /** Push's baseline: its last cycle's snapshot, or null when there is none (no file, or an unreadable one). */
    prev() {
      load();
      return prev;
    },
    /** The history's baseline: the last cycle's snapshot, push on or off; push's when the file has no other. */
    historyPrev() {
      load();
      return historyPrev;
    },
    commit({ history: h = null, push: p = null } = {}) {
      commit(h, p);
    },
    /**
     * Both baselines move to `snap`; `events` are recorded and, with `push`,
     * queued. With push off only the history's moves, and each is `off`.
     */
    advance(snap, events = [], { push = true } = {}) {
      commit({ snap, events }, push ? { snap, events } : null);
    },
    /**
     * A producer's notices (#581): `state` becomes what the file holds for
     * `name` (a copy, so the producer's later changes stay out of the file
     * until its next notify), and `events` are recorded in the history and,
     * with `push`, queued behind the outbox, collapsing and dropping as a
     * cycle's do. One write. The caller wakes the sender.
     *
     * @param {string} name
     * @param {object} state
     * @param {object[]} [events]
     * @param {{ push?: boolean }} [opts]
     */
    notify(name, state, events = [], { push = true } = {}) {
      load();
      producers.set(name, structuredClone(state));
      if (events.length > 0) {
        const ids = history.record(events, push ? 'queued' : 'off');
        if (push) enqueue(events, ids);
      }
      persist();
    },
    /** What the file holds for producer `name` (a copy), or undefined when it holds none. */
    producerState(name) {
      load();
      return producers.has(name) ? structuredClone(producers.get(name)) : undefined;
    },
    /** Whether the file was there at start but couldn't be read or parsed: what it held is gone. */
    unreadable() {
      load();
      return lost;
    },
    /**
     * One page of the alert history, newest first (alertHistory.js page):
     * GET /api/events.
     */
    events(query) {
      load();
      return history.page(query);
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
    /**
     * Take `entry` off the outbox: done with by every phone. Its record says
     * what they did. Written by the sender's save() at the end of its round,
     * once for all it finished.
     */
    complete(entry) {
      const i = queue.indexOf(entry);
      if (i === -1) return;
      queue.splice(i, 1);
      history.settle(entry.historyId, pushOutcome(entry.tally, 'done'));
      behind = true;
    },
    /** Write the file now: a sender round finished events, or a phone took one (its record: sent, so far to these phones). */
    save() {
      for (const e of queue) if (e.sent) history.settle(e.historyId, pushOutcome(e.tally, 'pending'));
      persist();
    },
    /** Write the file if it is behind memory (shutdown). */
    flush() {
      if (!behind || (prev === null && historyPrev === null && producers.size === 0)) return;
      persist();
    },
  };
}

/** Whether two baselines hold the same alert state (both none counts). */
function sameState(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return alertStateKey(a) === alertStateKey(b);
}

/**
 * One push cycle: build the current snapshot from each baseline and diff it
 * against that baseline (createPushSnapshot): the history's, every cycle, its
 * changes recorded (#267: the history is there without push); push's, only
 * with push on, its changes queued in the outbox. While push is on the two
 * baselines are the same, so one snapshot is built and diffed, and the history
 * is what was paged. Both move in one write (commit), then the sender
 * (push/outbox.js) is woken, which sends the queued events in order. Push off
 * (no FCM creds) leaves push's baseline, queues nothing and wakes no sender,
 * as before #267. The cycle never waits on a send
 * (#579): with Google out of reach a send can take minutes, and the refresh
 * loop, so /api/health and the board, would wait with it. The next cycle diffs against the advanced
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
 * alert. Graceful-disable: with no FCM creds nothing is queued or sent, and
 * push's baseline holds; the file holds the history and its baseline.
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
    const push = fcm.isPushEnabled();

    const historyPrev = snapshot.historyPrev();
    const prev = push ? snapshot.prev() : null;
    try {
      const shared = push && sameState(historyPrev, prev);
      const historySnap = buildSnapshotFn(historyPrev);
      const pushSnap = !push ? null : shared ? historySnap : buildSnapshotFn(prev);
      if (historySnap === null && pushSnap === null) {
        logger.debug('push cycle skipped: no snapshot this cycle');
        return;
      }

      // With no prev (no file, or an unreadable one) every entity is new: what
      // is in trouble pages once, what is ok sends nothing (#448).
      const recorded = historySnap === null ? [] : diffSnapshots(historyPrev, historySnap, status);
      const events =
        pushSnap === null ? [] : shared ? recorded : diffSnapshots(prev, pushSnap, status);
      snapshot.commit({
        history: historySnap === null ? null : { snap: historySnap, events: recorded },
        push: pushSnap === null ? null : { snap: pushSnap, events },
      });
      if (events.length > 0) {
        logger.info({ events: events.length, queued: snapshot.outbox().length }, 'push cycle queued');
      } else if (recorded.length > 0 && !push) {
        logger.debug({ events: recorded.length }, 'alert events recorded; push is off');
      }
    } finally {
      // Also when nothing was queued: a restart's outbox is sent from its first cycle.
      if (push) sender.wake();
    }
  } catch (err) {
    // Swallow EVERYTHING. This runs inside the refresh loop; it must never
    // reject or the loop's allSettled accounting / health gate could be hurt.
    logger.error({ err }, 'push cycle error (swallowed)');
  }
}
