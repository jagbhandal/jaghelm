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
import { envValue } from '../env.js';
import { giteaFailure } from '../gitea.js';
import { sourceUrlProblems, sourceUrlSet, sourceUrlUnsets } from '../sourceUrls.js';

export { buildStatus, sourcesOk } from './model.js';
export { DEFAULT_THRESHOLDS, resolveThresholds } from './thresholds.js';

// The production seam: the warm caches, the cron store, and why Gitea's last
// poll failed (#605). Every test injects its own.
export const liveCaches = {
  getCached,
  getCachedInternal,
  getAllCronStatuses: getAllStatuses,
  giteaFailure,
};

/**
 * The model's inputs from the warm caches and the cron store: the payloads the
 * refreshes cached this cycle, what the services refresh keeps beside its
 * payload, the drive read (drives.js; null when it did not run or failed), and
 * the cron statuses. `getAllCronStatuses` reads cron-jobs.json,
 * once a cycle: push reads the jobs from the model, not the file.
 * `giteaFailure`, when given, says why Gitea's last poll failed (gitea.js);
 * without it there is none.
 *
 * @param {object} [caches]  getCached, getCachedInternal, getAllCronStatuses, giteaFailure?
 * @param {{ cycleErrors?: string[], backupJobs?: string[], restartLimits?: Record<string, number>, arcaneAgents?: Array<{ env: string, state: string }> | null, configProblem?: string | null, env?: Record<string, string | undefined> }} [extra]
 *   cycleErrors: runCycleRefreshes' error set (it says whether Gitea failed;
 *   why is its poll's, gitea.js giteaFailure, #605);
 *   backupJobs: the "node:job" keys display-config.json marks as backups
 *   (status/backupJobs.js); restartLimits: its per-container restart-loop
 *   limits (status/restartLimits.js, #799); arcaneAgents: the Arcane poller's agents
 *   (arcane/agents.js; null: Arcane not set up or not polled yet);
 *   configProblem: why services.yaml is no usable config ("services.yaml
 *   doesn't parse (line 4)", config.js configProblem, #505), or null; env:
 *   where KUMA_URL and JAGHELM_GITEA_URL are read from (the process's
 *   environment unless a test passes its own), and which of the source URLs
 *   is refused for holding a user or password (sourceUrls.js, #419) or, for
 *   Prometheus, is unset (#704): both make their source off, with their own
 *   words, never the unreachable of a wrong address. The loop
 *   passes all but env (refresh.js updateStatus, #291).
 */
export function readStatusInputs(caches = liveCaches, extra = {}) {
  const {
    cycleErrors = [],
    backupJobs = [],
    restartLimits = {},
    arcaneAgents = null,
    configProblem = null,
    env,
  } = extra;
  return {
    services: caches.getCached('services'),
    servicesInternal: caches.getCachedInternal?.('services') ?? null,
    ups: caches.getCached('ups'),
    integrations: caches.getCached('integrations'),
    drives: caches.getCached('drives') ?? null,
    // The last read of cAdvisor's restart and OOM events (containerEvents.js, #764); null: none yet.
    containerEvents: caches.getCached('containerEvents') ?? null,
    cron: caches.getAllCronStatuses(),
    backupJobs,
    restartLimits,
    arcaneAgents,
    kumaConfigured: sourceUrlSet('kuma', env),
    giteaConfigured: sourceUrlSet('gitea', env),
    giteaFailure: typeof caches.giteaFailure === 'function' ? caches.giteaFailure() : null,
    refusedSources: { ...sourceUrlUnsets(env), ...sourceUrlProblems(env) },
    cycleErrors,
    configProblem,
    // How long a container is missing before it pages (#775); a read of env, so the model stays pure.
    missingPushAfterMs: envValue('JAGHELM_MISSING_PUSH_AFTER_MS', env),
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
 * over its line, and with when each hold began (#469), so a restart doesn't
 * start a hold's 24 h again (memoryFromLevels).
 *
 * `onDriveFault`, when given, is told after each build whether judging a
 * node's drives threw (the error, or null; model.js buildStatus).
 *
 * @param {{ seed?: (thresholds: import('./thresholds.js').Thresholds) => any, onDriveFault?: (err: unknown) => void }} [opts]
 */
export function createStatusTracker({ seed, onDriveFault } = {}) {
  let memory = null;
  let current = null;
  let seeded = typeof seed !== 'function';
  return {
    /**
     * @param {{ inputs: any, thresholds: import('./thresholds.js').Thresholds, units?: string, now: number }} cycle
     */
    update({ inputs, thresholds, units, now }) {
      if (!seeded) {
        seeded = true;
        memory = seed(thresholds) ?? null;
      }
      const built = buildStatus({ inputs, thresholds, units, memory, now, onDriveFault });
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
 * `heldSince`, when given, maps a node key to when each of its held readings'
 * hold began (push/snapshot.js heldSinceOf, #469), so a restart keeps a hold's
 * 24 h running from where push's snapshot has it, and the model and the
 * snapshot end it on the same cycle.
 *
 * @param {Record<string, Record<string, string>>} levels
 * @param {{ nodes?: string[] | null, heldSince?: Record<string, Record<string, number>> }} [opts]
 */
export function memoryFromLevels(levels, { nodes = null, heldSince = {} } = {}) {
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
    const held = heldSince?.[nodeKey];
    if (held && typeof held === 'object' && Object.keys(held).length > 0)
      entities[id].memo.held = { ...held };
  }
  return { entities, sources: {} };
}
