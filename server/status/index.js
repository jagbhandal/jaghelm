/**
 * The status model's live seam (#290, wired in by #292): what it reads from
 * the running server, and a tracker that carries its memory from one cycle to
 * the next.
 *
 * The background loop (refresh.js) runs the tracker once a cycle, after the
 * refreshes: /api/status serves the result, and push builds its snapshot from
 * it (push/snapshot.js), so nothing else on the server judges an entity.
 */
import { getCached, getCachedInternal } from '../cache.js';
import { getAllStatuses } from '../cron-store.js';
import { buildStatus } from './model.js';

export { buildStatus, sourcesOk } from './model.js';
export { DEFAULT_THRESHOLDS, resolveThresholds } from './thresholds.js';

// The production seam: the warm caches and the cron store. Every test injects
// its own.
export const liveCaches = {
  getCached,
  getCachedInternal,
  getAllCronStatuses: getAllStatuses,
};

/**
 * The model's inputs from the warm caches and the cron store: the payloads the
 * refreshes cached this cycle, what the services refresh keeps beside its
 * payload, and the cron statuses. `getAllCronStatuses` reads cron-jobs.json,
 * once a cycle: push reads the jobs from the model, not the file.
 *
 * @param {object} [caches]  getCached, getCachedInternal, getAllCronStatuses
 * @param {{ cycleErrors?: string[], backupJobs?: string[], arcaneAgents?: Array<{ env: string, state: string }> | null, env?: Record<string, string | undefined> }} [extra]
 *   cycleErrors: runCycleRefreshes' error set (it says whether Gitea failed);
 *   backupJobs: the "node:job" keys display-config.json marks as backups
 *   (status/backupJobs.js); arcaneAgents: the Arcane poller's agents
 *   (arcane/agents.js; null: Arcane not set up or not polled yet); env: where
 *   KUMA_URL and GITEA_URL are read from. The loop passes all of them
 *   (refresh.js updateStatus, #291).
 */
export function readStatusInputs(caches = liveCaches, extra = {}) {
  const { cycleErrors = [], backupJobs = [], arcaneAgents = null, env = process.env } = extra;
  return {
    services: caches.getCached('services'),
    servicesInternal: caches.getCachedInternal?.('services') ?? null,
    ups: caches.getCached('ups'),
    integrations: caches.getCached('integrations'),
    cron: caches.getAllCronStatuses(),
    backupJobs,
    arcaneAgents,
    kumaConfigured: Boolean(env.KUMA_URL),
    giteaConfigured: Boolean(env.GITEA_URL),
    cycleErrors,
  };
}

/**
 * Builds the model once a cycle and keeps its memory for the next. `update`
 * returns the new status; `current` the last one (null before the first).
 *
 * The memory lives in this process. `seed(thresholds)`, when given, is asked
 * once, before the first build, for the memory to start from (null: none).
 * The background loop seeds it with the levels push last persisted (#361), so
 * a restart doesn't forget that a reading inside a hysteresis band is still
 * over its line (memoryFromLevels).
 *
 * @param {{ seed?: (thresholds: import('./thresholds.js').Thresholds) => any }} [opts]
 */
export function createStatusTracker({ seed } = {}) {
  let memory = null;
  let current = null;
  let seeded = typeof seed !== 'function';
  return {
    /**
     * @param {{ inputs: any, thresholds: import('./thresholds.js').Thresholds, now: number }} cycle
     */
    update({ inputs, thresholds, now }) {
      if (!seeded) {
        seeded = true;
        memory = seed(thresholds) ?? null;
      }
      const built = buildStatus({ inputs, thresholds, memory, now });
      memory = built.memory;
      current = built.status;
      return current;
    },
    current() {
      return current;
    },
  };
}

/**
 * A memory for buildStatus that knows only each node's levels: `levels` maps a
 * node key to the level of each of its readings (`{ disk: 'warn', cpu: 'ok' }`,
 * the shape of a node's `conditions`). Hysteresis reads a reading's level from
 * the memory, so a node seeded with `disk: 'warn'` stays warn while its disk is
 * inside the band, as it would have had the process kept running. Everything
 * else starts as on a first cycle.
 *
 * `nodes`, when given, are the nodes services.yaml has: a node taken out of
 * it is not seeded, so the model doesn't keep it as unknown while Prometheus
 * fails.
 *
 * @param {Record<string, Record<string, string>>} levels
 * @param {{ nodes?: string[] | null }} [opts]
 */
export function memoryFromLevels(levels, { nodes = null } = {}) {
  const configured = Array.isArray(nodes) ? new Set(nodes) : null;
  const entities = {};
  for (const [nodeKey, byReading] of Object.entries(levels ?? {})) {
    if (!byReading || typeof byReading !== 'object') continue;
    if (configured && !configured.has(nodeKey)) continue;
    const id = `nodes/${nodeKey}`;
    entities[id] = {
      id,
      kind: 'node',
      subsystem: 'nodes',
      name: nodeKey,
      node: nodeKey,
      memo: { levels: { ...byReading }, streak: {} },
    };
  }
  return { entities, sources: {} };
}
