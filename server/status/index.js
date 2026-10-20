/**
 * The status model's live seam (#290): what it reads from the running server,
 * and a tracker that carries its memory from one cycle to the next.
 *
 * Nothing calls these yet. #292 runs the tracker once per background cycle,
 * after the refreshes, and serves its status at /api/status; push's differ
 * then consumes the same model. Until then the model computes nothing in the
 * refresh loop.
 */
import { liveCaches } from '../push/snapshot.js';
import { buildStatus } from './model.js';

export { buildStatus } from './model.js';
export { DEFAULT_THRESHOLDS, pushThresholdsOf, resolveThresholds } from './thresholds.js';

/**
 * The model's inputs from the warm caches and the cron store: the payloads the
 * refreshes cached this cycle, what the services refresh keeps beside its
 * payload, and the cron statuses, read through the same seam as the push
 * snapshot (push/snapshot.js liveCaches), so both judge the same data.
 *
 * @param {object} [caches]  getCached, getCachedInternal, getAllCronStatuses
 * @param {{ cycleErrors?: string[], backupJobs?: string[], arcaneAgents?: Array<{ env: string, state: string }> | null, env?: Record<string, string | undefined> }} [extra]
 *   cycleErrors: runCycleRefreshes' error set (it says whether Gitea failed);
 *   backupJobs and arcaneAgents: #291's (none until then); env: where
 *   KUMA_URL and GITEA_URL are read from.
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
 */
export function createStatusTracker() {
  let memory = null;
  let current = null;
  return {
    /**
     * @param {{ inputs: any, thresholds: import('./thresholds.js').Thresholds, now: number }} cycle
     */
    update({ inputs, thresholds, now }) {
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
