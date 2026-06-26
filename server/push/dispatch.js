/**
 * Push dispatch: the pure pref-filter (shouldDeliver/categoryOf), the
 * fan-out (dispatchEvents), and the per-cycle orchestrator (runPushCycle).
 *
 * shouldDeliver + categoryOf are PURE and clock-free (determinism law).
 * dispatchEvents + runPushCycle own the I/O (fcm.send, snapshot file) and
 * are the only places a clock or side effect lives.
 */
import { existsSync, readFileSync } from 'fs';

import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { createLogger } from '../util/logger.js';
import { diffSnapshots, RECOVERY_TYPES } from './differ.js';

const defaultLog = createLogger('push-dispatch');

// DEFAULT_PREFS has a single owner: server/push/tokenStore.js. shouldDeliver
// receives already-resolved prefs, so dispatch.js does not redefine it.

/** Map an event type to its preference category. */
export function categoryOf(type) {
  if (type.startsWith('service_')) return 'service';
  if (type.startsWith('host_')) return 'host';
  if (type.startsWith('ups_')) return 'ups';
  if (type.startsWith('cron_')) return 'cron';
  return 'service'; // unreachable for contract types; conservative default
}

/**
 * Pure pref filter. Returns true iff this event should be delivered under
 * the given per-token prefs. No clock, no I/O.
 */
export function shouldDeliver(event, prefs) {
  if (!prefs.enabled) return false;
  if (prefs.categories[categoryOf(event.type)] === false) return false;
  if (RECOVERY_TYPES.has(event.type) && !prefs.notifyRecoveries) return false;
  return true;
}

/**
 * Fan a list of events across every registered token, honoring each token's
 * prefs. A token whose send asks to be pruned (dead/invalid registration) is
 * removed exactly once at the end. Returns delivery counts.
 *
 * @param {Array} events  events from diffSnapshots (already canonically sorted)
 * @param {object} deps   { store, fcm, logger }
 * @returns {Promise<{sent:number, suppressed:number, pruned:number}>}
 */
export async function dispatchEvents(events, { store, fcm, logger = defaultLog }) {
  let sent = 0;
  let suppressed = 0;
  const toPrune = new Set();

  const tokens = store.getAllTokens();
  for (const event of events) {
    for (const { token } of tokens) {
      const prefs = store.getPrefs(token);
      if (!shouldDeliver(event, prefs)) {
        suppressed += 1;
        continue;
      }
      const result = await fcm.sendToToken(token, event);
      sent += 1;
      if (result && result.prune) toPrune.add(token);
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
 * One push cycle: build the current snapshot, diff it against the persisted
 * previous snapshot, dispatch the resulting events, then persist the new
 * snapshot (ALWAYS — even on baseline — so the next cycle has a prev).
 *
 * Total error isolation: the entire body is wrapped so it can NEVER reject.
 * It runs inside the background refresh loop and must never break that loop.
 * Graceful-disable: if push has no FCM creds it returns immediately and does
 * not even read or write the snapshot file.
 *
 * @param {object} deps
 * @param {Function} deps.buildSnapshotFn  () => Snapshot (injected; fakeable)
 * @param {object}   deps.store            token store
 * @param {object}   deps.fcm              fcm module
 * @param {string}   deps.snapshotPath     path to the persisted prev snapshot
 * @param {object}   deps.thresholds       diff thresholds
 * @param {object}   [deps.logger]
 * @returns {Promise<void>}
 */
export async function runPushCycle({ buildSnapshotFn, store, fcm, snapshotPath, thresholds, logger = defaultLog }) {
  try {
    if (!fcm.isPushEnabled()) return;

    const snap = buildSnapshotFn();

    let prev = null;
    if (existsSync(snapshotPath)) {
      try {
        prev = JSON.parse(readFileSync(snapshotPath, 'utf8'));
      } catch (err) {
        // Corrupt/partial snapshot => treat as baseline rather than crash.
        logger.warn({ err }, 'unreadable push snapshot, treating as baseline');
        prev = null;
      }
    }

    if (prev !== null) {
      const events = diffSnapshots(prev, snap, thresholds);
      if (events.length > 0) {
        const counts = await dispatchEvents(events, { store, fcm, logger });
        logger.info({ ...counts, events: events.length }, 'push cycle dispatched');
      }
    }

    // Always advance the persisted snapshot so the next cycle has a prev.
    atomicWriteFileSync(snapshotPath, JSON.stringify(snap));
  } catch (err) {
    // Swallow EVERYTHING. This runs inside the refresh loop; it must never
    // reject or the loop's allSettled accounting / health gate could be hurt.
    logger.error({ err }, 'push cycle error (swallowed)');
  }
}
