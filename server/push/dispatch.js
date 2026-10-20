/**
 * Push dispatch: the pure pref-filter (shouldDeliver/categoryOf), the
 * fan-out (dispatchEvents), the prev-snapshot memory (createPushSnapshot) and
 * the per-cycle orchestrator (runPushCycle).
 *
 * shouldDeliver + categoryOf are PURE and clock-free (determinism law).
 * dispatchEvents, createPushSnapshot and runPushCycle own the I/O (fcm.send,
 * snapshot file) and are the only places a clock or side effect lives.
 */
import { existsSync, readFileSync } from 'fs';

import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { createLogger } from '../util/logger.js';
import { alertStateKey, diffSnapshots, RECOVERY_TYPES } from './differ.js';

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

/** Map an event (its type, and for a source event its id) to its preference category. */
export function categoryOf(type, id) {
  if (Object.hasOwn(TYPE_CATEGORY, type)) return TYPE_CATEGORY[type];
  if (SOURCE_TYPES.has(type)) return Object.hasOwn(SOURCE_CATEGORY, id) ? SOURCE_CATEGORY[id] : 'host';
  return type.split('_')[0];
}

/**
 * Pure pref filter. Returns true iff this event should be delivered under
 * the given per-token prefs. No clock, no I/O.
 */
export function shouldDeliver(event, prefs) {
  if (!prefs.enabled) return false;
  if (prefs.categories[categoryOf(event.type, event.id)] === false) return false;
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

  for (const token of toPrune) delivered.delete(token);
  if (delivered.size > 0) {
    try {
      store.markDelivered([...delivered]);
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

  return { sent, suppressed, pruned: toPrune.size };
}

/**
 * The previous cycle's snapshot, which the next cycle diffs against. It lives
 * in memory; the file at `path` is for restarts: read on first use, so a
 * restart diffs against the last persisted state (no re-alert, no missed
 * change), and rewritten only when alertStateKey changes. The snapshot holds
 * states and levels, not readings (#292), so a steady board costs no write,
 * and the status model is seeded with the file's levels at boot (#361), so a
 * restart keeps every episode.
 *
 * A failed write is logged and retried every cycle until it lands. Memory moves
 * on regardless, so the running process does not send the alert again. Until
 * the write lands, a restart diffs against the older file: it can re-send an
 * alert, or miss the recovery of one already sent. flush() writes the latest
 * snapshot on shutdown if the file is behind.
 *
 * `upgrade` brings a file an older version wrote to this one's shape as it is
 * read (refresh.js: push/snapshot.js upgradeSnapshot, levels for a pre-#292
 * file's readings), so the first cycle diffs like any other.
 *
 * @param {object}   opts
 * @param {string}   opts.path       the persisted snapshot file
 * @param {Function} [opts.write]    atomic writer (injected in tests)
 * @param {Function} [opts.upgrade]  (snapshot) => snapshot, applied to what the file holds
 * @param {object}   [opts.logger]
 */
export function createPushSnapshot({ path, write = atomicWriteFileSync, upgrade = (snap) => snap, logger = defaultLog }) {
  let loaded = false;
  let prev = null; // the last cycle's snapshot (null: baseline)
  let persisted = null; // what the file holds (null: nothing usable)

  function load() {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      // Corrupt/partial snapshot => treat as baseline rather than crash.
      logger.warn({ err }, 'unreadable push snapshot, treating as baseline');
      return null;
    }
  }

  function persist(snap) {
    try {
      write(path, JSON.stringify(snap));
      persisted = snap;
    } catch (err) {
      logger.error({ err }, 'failed to persist push snapshot, retrying next cycle');
    }
  }

  return {
    /** The previous cycle's snapshot, or null on the first cycle (baseline). */
    prev() {
      if (!loaded) {
        const read = load();
        prev = persisted = read === null ? null : upgrade(read);
        loaded = true;
      }
      return prev;
    },
    /** Make `snap` the next cycle's prev, and write it if the file is behind. */
    advance(snap) {
      prev = snap;
      loaded = true;
      if (persisted !== null && alertStateKey(persisted) === alertStateKey(snap)) return;
      persist(snap);
    },
    /** Write the in-memory snapshot if the file holds an older one (shutdown). */
    flush() {
      if (prev === null || JSON.stringify(prev) === JSON.stringify(persisted)) return;
      persist(prev);
    },
  };
}

/**
 * One push cycle: build the current snapshot, diff it against the previous
 * one, dispatch the resulting events, then advance the previous snapshot
 * (ALWAYS — even on baseline — so the next cycle has a prev).
 *
 * The builder is handed the previous snapshot, so what the status model can't
 * call, and the parts fed by a source that failed this cycle, can be kept from
 * it (buildSnapshot, #232, #292). Advancing to that snapshot keeps them for the
 * next cycle too, however long the failure. `status` is the model the snapshot
 * was built from: each event takes its words from it.
 * A builder that returns null has no snapshot to give (a baseline taken while a
 * source fails would record its failure as state): the cycle is skipped, and
 * nothing is diffed, sent or advanced.
 *
 * Total error isolation: the entire body is wrapped so it can NEVER reject.
 * It runs inside the background refresh loop and must never break that loop.
 * Graceful-disable: if push has no FCM creds it returns immediately and does
 * not even read or write the snapshot file.
 *
 * @param {object} deps
 * @param {Function} deps.buildSnapshotFn  (prev) => Snapshot | null (injected; fakeable)
 * @param {object|null} [deps.status]      the status model of this cycle (the events' words)
 * @param {object}   deps.store            token store
 * @param {object}   deps.fcm              fcm module
 * @param {object}   deps.snapshot         prev-snapshot memory (createPushSnapshot)
 * @param {object}   [deps.logger]
 * @returns {Promise<void>}
 */
export async function runPushCycle({ buildSnapshotFn, status = null, store, fcm, snapshot, logger = defaultLog }) {
  try {
    store.pruneStale();
    if (!fcm.isPushEnabled()) return;

    const prev = snapshot.prev();
    const snap = buildSnapshotFn(prev);
    if (snap === null) {
      // A baseline would record a failed source as state (buildSnapshot), or
      // the cycle has no status model (refresh.js runStatusAndPush).
      logger.debug({ baseline: prev === null }, 'push cycle skipped: no snapshot this cycle');
      return;
    }

    if (prev !== null) {
      const events = diffSnapshots(prev, snap, status);
      if (events.length > 0) {
        const counts = await dispatchEvents(events, { store, fcm, logger });
        logger.info({ ...counts, events: events.length }, 'push cycle dispatched');
      }
    }

    // Advance only after a clean dispatch: one that throws leaves prev as it
    // was, so the next cycle diffs against it again instead of dropping the alert.
    snapshot.advance(snap);
  } catch (err) {
    // Swallow EVERYTHING. This runs inside the refresh loop; it must never
    // reject or the loop's allSettled accounting / health gate could be hurt.
    logger.error({ err }, 'push cycle error (swallowed)');
  }
}
