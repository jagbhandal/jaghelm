/**
 * Test-only: the status-and-push half of a background cycle, as refresh.js
 * runs it (#292). The status tracker builds the model from the caches, seeded
 * at its first cycle with the levels the push snapshot file holds (#361); the
 * push snapshot is built from that status, and the real push cycle diffs it,
 * queues the events with it in a file, and the real sender (push/outbox.js,
 * #579) sends them to a recording FCM. A cycle returns once the sender is done
 * or waits to try again.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPushSnapshot, runPushCycle } from '../push/dispatch.js';
import { createPushSender } from '../push/outbox.js';
import { buildSnapshot, cycleSnapshot, heldLevels, heldSinceOf, upgradeSnapshot } from '../push/snapshot.js';
import { createStatusTracker, memoryFromLevels, readStatusInputs } from '../status/index.js';
import { DEFAULT_THRESHOLDS } from '../status/thresholds.js';

export const CYCLE_MS = 30_000;
const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** A token store with one phone that takes every event. */
export function onePhone() {
  return {
    getAllTokens: () => [{ token: 'phone' }],
    getPrefs: () => ({
      enabled: true,
      notifyRecoveries: true,
      categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
    }),
    removeToken: () => true,
    pruneStale: () => 0,
    markDelivered: () => 0,
  };
}

/** A tracker seeded, as the loop's is, from what `snapshot` holds: its levels, and when each hold began (#469). */
export function seededTracker(snapshot) {
  return createStatusTracker({
    seed: (thresholds) => {
      const prev = snapshot.prev();
      return memoryFromLevels(heldLevels(prev, thresholds), { heldSince: heldSinceOf(prev) });
    },
  });
}

/**
 * A push pipeline over a snapshot file. Its first cycle has no snapshot, so it
 * diffs every entity from no previous state (#448), unless `path` names another
 * pipeline's file: then it is that pipeline after a restart. `cycle(caches)` runs one cycle on `caches` (getCached,
 * getCachedInternal, getAllCronStatuses); `restart()` stops and starts JagHelm.
 *
 * @param {{ path?: string, thresholds?: any, start?: number, env?: Record<string, string> }} [opts]
 */
export function pushPipeline({
  path,
  thresholds = DEFAULT_THRESHOLDS,
  start = 1_782_345_600_000,
  env = {},
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-push-'));
  const file = path ?? join(dir, 'push-snapshot.json');
  const open = () =>
    createPushSnapshot({
      path: file,
      logger: silent,
      upgrade: (snap) => upgradeSnapshot(snap, thresholds),
    });
  let now = start;
  let pushUp = true;
  let sendFails = false;
  const sent = [];
  const events = [];
  const fcm = {
    isPushEnabled: () => pushUp,
    sendToToken: async (_token, event) => {
      if (sendFails) return { ok: false, prune: false, retry: true, error: 'app/network-error' };
      sent.push(`${event.type} ${event.id}`);
      events.push(event);
      return { ok: true, prune: false };
    },
  };
  // The sender's wait before trying again lasts until the next cycle.
  let retry = null; // ends the wait the sender is in
  let onWait = null;
  const sleep = () =>
    new Promise((resolve) => {
      retry = resolve;
      onWait?.();
    });
  const sendersOf = (memory) =>
    createPushSender({ outbox: memory, store: onePhone(), fcm, logger: silent, sleep });
  let snapshot = open();
  let sender = sendersOf(snapshot);
  let tracker = seededTracker(snapshot);
  /** Until the sender has sent all it can: done, or waiting to try again. */
  const sendsSettled = () =>
    new Promise((resolve) => {
      if (retry) return resolve();
      onWait = resolve;
      sender.idle().then(resolve);
    });
  const pipeline = {
    path: file,
    sent,
    events,
    status: null,
    get snapshot() {
      return snapshot;
    },
    /**
     * One cycle. `thresholds` replaces the pipeline's for this cycle and the
     * next ones (a hand edit of display-config.json); `backupJobs` are the
     * cron jobs marked as backups and `arcaneAgents` the Arcane poller's
     * agents (#291). `push: false` is a cycle push sits out (FCM not up yet,
     * the boot race): the model moves on and the snapshot doesn't (#469).
     * `failSend` is one whose sends Google fails: the snapshot moves on, and
     * its pushes wait in the outbox for the next cycle (#579). `modelThrows` is a
     * cycle whose status model threw (#440): there is no status, and the
     * snapshot is built as refresh.js builds it then (cycleSnapshot).
     */
    async cycle(
      caches,
      {
        cycleErrors = [],
        thresholds: t,
        backupJobs = [],
        arcaneAgents = null,
        push = true,
        failSend = false,
        modelThrows = false,
      } = {}
    ) {
      if (t) thresholds = t;
      const status = modelThrows
        ? null
        : tracker.update({
            inputs: readStatusInputs(caches, { cycleErrors, env, backupJobs, arcaneAgents }),
            thresholds,
            now,
          });
      pipeline.status = status;
      now += CYCLE_MS;
      pushUp = push;
      sendFails = failSend;
      const waiting = retry;
      retry = null;
      waiting?.(); // a cycle later: the sender tries again
      await runPushCycle({
        buildSnapshotFn: (prev) => cycleSnapshot(caches, prev, status),
        status,
        store: onePhone(),
        fcm,
        snapshot,
        sender,
        logger: silent,
      });
      await sendsSettled();
      return status;
    },
    /** When the next cycle runs, by the pipeline's clock. */
    get now() {
      return now;
    },
    /** Moves the pipeline's clock on by `ms` (each cycle moves it CYCLE_MS). */
    advance(ms) {
      now += ms;
    },
    restart() {
      snapshot.flush();
      retry = null; // a sender waiting to try again stops with the process
      snapshot = open();
      sender = sendersOf(snapshot);
      tracker = seededTracker(snapshot);
    },
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return pipeline;
}

/**
 * The caches a push cycle reads, from a services payload, what the services
 * refresh keeps beside it, the UPS payload and the cron statuses.
 */
export function cachesOf({
  services = null,
  internal = null,
  ups = null,
  integrations = null,
  cron = [],
}) {
  return {
    getCached: (key) => ({ services, ups, integrations })[key] ?? null,
    getCachedInternal: (key) => (key === 'services' ? internal : null),
    getAllCronStatuses: () => cron,
  };
}

// A UPS refresh that answered: no UPS is set up.
const NO_UPS = Object.freeze({
  status: null,
  charge: null,
  runtime: null,
  load: null,
  ok: true,
  configured: false,
  model: null,
});

/** The caches after one assembleServices result `r`, every source answering (and no UPS). */
export function cachesOfAssembled(r, { ups = NO_UPS, cron = [], sources } = {}) {
  return cachesOf({
    services: {
      nodes: r.nodes,
      overallHealth: r.overallHealth,
      sources: sources ?? { prometheus: { ok: true }, kuma: { ok: true } },
    },
    internal: {
      upWithoutCard: r.upWithoutCard,
      monitorOf: r.monitorOf,
      kumaStatusOf: r.kumaStatusOf,
      kumaWithoutCard: r.kumaWithoutCard,
      backedBy: r.backedBy,
    },
    ups,
    cron,
  });
}

/**
 * One cycle's push snapshot, as a JagHelm that has just started would build
 * it: a model seeded from `prev` (its levels), then the snapshot from that.
 * Returns the snapshot (never null since #461: there is no baseline wait) and
 * the status.
 */
export function snapshotAfter(
  caches,
  prev = null,
  { thresholds = DEFAULT_THRESHOLDS, now = 1_782_345_600_000, cycleErrors = [] } = {}
) {
  const tracker = createStatusTracker({
    seed: (t) => memoryFromLevels(heldLevels(prev, t), { heldSince: heldSinceOf(prev) }),
  });
  const status = tracker.update({
    inputs: readStatusInputs(caches, { cycleErrors, env: {} }),
    thresholds,
    now,
  });
  return { snapshot: buildSnapshot(caches, prev, status), status };
}
