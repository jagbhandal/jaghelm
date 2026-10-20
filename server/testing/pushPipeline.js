/**
 * Test-only: the status-and-push half of a background cycle, as refresh.js
 * runs it (#292). The status tracker builds the model from the caches, seeded
 * at its first cycle with the levels the push snapshot file holds (#361); the
 * push snapshot is built from that status, and the real push cycle diffs it,
 * dispatches to a recording FCM and persists it to a file.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPushSnapshot, runPushCycle } from '../push/dispatch.js';
import { buildSnapshot, heldLevels } from '../push/snapshot.js';
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

/** A tracker seeded, as the loop's is, from what `snapshot` holds. */
export function seededTracker(snapshot) {
  return createStatusTracker({
    seed: (thresholds) => memoryFromLevels(heldLevels(snapshot.prev(), thresholds)),
  });
}

/**
 * A push pipeline over a snapshot file. Its first cycle is the baseline, unless
 * `path` names another pipeline's file: then it is that pipeline after a
 * restart. `cycle(caches)` runs one cycle on `caches` (getCached,
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
  let snapshot = createPushSnapshot({ path: file, logger: silent });
  let tracker = seededTracker(snapshot);
  let now = start;
  const sent = [];
  const events = [];
  const fcm = {
    isPushEnabled: () => true,
    sendToToken: async (_token, event) => {
      sent.push(`${event.type} ${event.id}`);
      events.push(event);
      return { ok: true, prune: false };
    },
  };
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
     * cron jobs marked as backups (#291).
     */
    async cycle(caches, { cycleErrors = [], thresholds: t, backupJobs = [] } = {}) {
      if (t) thresholds = t;
      const status = tracker.update({
        inputs: readStatusInputs(caches, { cycleErrors, env, backupJobs }),
        thresholds,
        now,
      });
      pipeline.status = status;
      now += CYCLE_MS;
      await runPushCycle({
        buildSnapshotFn: (prev) => buildSnapshot(caches, prev, status),
        status,
        store: onePhone(),
        fcm,
        snapshot,
        logger: silent,
      });
      return status;
    },
    /** Moves the pipeline's clock on by `ms` (each cycle moves it CYCLE_MS). */
    advance(ms) {
      now += ms;
    },
    restart() {
      snapshot.flush();
      snapshot = createPushSnapshot({ path: file, logger: silent });
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
 * Returns the snapshot (null: no baseline yet) and the status.
 */
export function snapshotAfter(
  caches,
  prev = null,
  { thresholds = DEFAULT_THRESHOLDS, now = 1_782_345_600_000, cycleErrors = [] } = {}
) {
  const tracker = createStatusTracker({ seed: (t) => memoryFromLevels(heldLevels(prev, t)) });
  const status = tracker.update({
    inputs: readStatusInputs(caches, { cycleErrors, env: {} }),
    thresholds,
    now,
  });
  return { snapshot: buildSnapshot(caches, prev, status), status };
}
