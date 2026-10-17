/**
 * Pure derivation of JagHelm state from Arcane API rows.
 * No clock, no I/O.
 */

const ENV_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const TERMINAL = new Set(['success', 'failed', 'cancelled']);
const ROW_ERROR_MAX = 200;
const CRON_ERROR_MAX = 2048;
const WINDOW_GRACE_MS = 60_000;

const str = (v) => (typeof v === 'string' ? v : '');

/** Safe environment name for store keys, or null. */
export function envKey(env) {
  const name = env?.name;
  if (typeof name !== 'string' || !ENV_NAME_RE.test(name) || RESERVED.has(name)) return null;
  return name;
}

export function envHealth(env) {
  switch (env?.status) {
    case 'online':
    case 'standby':
      return 'up';
    case 'offline':
    case 'error':
      return 'down';
    default:
      return 'unknown';
  }
}

const containerName = (c) => str(c?.names?.[0]).replace(/^\//, '');
const latestOf = (info) => str(info.latestVersion) || str(info.latestDigest).slice(0, 19);

/** Containers with a pending update that Arcane will not apply on its own. */
export function heldBackSet(containers, { checkOnly }) {
  const out = [];
  for (const c of Array.isArray(containers) ? containers : []) {
    const info = c?.updateInfo;
    if (info?.hasUpdate !== true) continue;
    if (!(c.autoUpdateEnabled === false || checkOnly)) continue;
    const name = containerName(c);
    if (!name) continue;
    out.push({
      name,
      current: str(info.currentVersion) || str(info.currentDigest).slice(0, 19),
      latest: latestOf(info),
    });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Every container with a pending update, any tier: name -> latest, sorted by name. */
export function pendingMap(containers) {
  const out = new Map();
  for (const c of Array.isArray(containers) ? containers : []) {
    const info = c?.updateInfo;
    if (info?.hasUpdate !== true) continue;
    const name = containerName(c);
    if (name) out.set(name, latestOf(info));
  }
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Which held-back transitions are news. "Held back" is image news: X is announced
 * only when it is newly pending or its latest changed since the previous pending map,
 * so a policy-only move into the held tier (a label added, check-only switched on) is
 * silent. "Caught up" means the update is resolved: X is announced only when it is no
 * longer pending at all, so leaving the held tier while still pending (label removed,
 * check-only switched off) is silent. prevPending null (a state file from before the
 * pending map existed) keeps every newly held-back entry, as before.
 */
export function heldBackTransitions({ newlyHeldBack, cleared, prevPending, nextPending }) {
  const heldBack = newlyHeldBack.filter(
    (e) => !prevPending || prevPending.get(e.name) !== e.latest
  );
  const caughtUp = cleared.filter((e) => !nextPending.has(e.name));
  return { heldBack, caughtUp };
}

export function isTerminal(activity) {
  return TERMINAL.has(activity?.status);
}

/*
 * Who started a finished auto_update / system_prune activity. In Arcane v2.16.1 the
 * activity itself cannot tell: a scheduled and a manual run have the same shape.
 *   - startedBy is always serialised, {username:"System"} when no user is recorded
 *     (backend/internal/activity/service.go:1585-1588), so a scheduled run and the
 *     Prune button (system/children/prune/service.go:106, 133-155) look alike, and
 *     POST /updater/run (updater/handler.go:58, updater/service.go:238-262) matches
 *     the scheduled auto-update template (updater/service.go:1549-1557).
 *   - batchId is set for every job-started run (job/service.go:672,
 *     scheduler/runs/coordinator.go:523-524, activity/service.go:337-342), a Jobs-page
 *     "Run now" included (trigger "manual", job/handler.go:80-84), so it is no signal.
 * The signal is the run's job_run summary activity: metadata.trigger plus
 * metadata.domainActivityId, the activity the run produced (activity/service.go:
 * 1714-1720; the auto-update outcome carries it, updater/service.go finalizeAutoUpdate;
 * the prune outcome too, scheduler/scheduled_prune_job.go:93-96). The scheduler fires
 * "scheduled", or "recovery" for a slot it runs late (scheduler/runs/actors.go:306-310),
 * so the scheduled work did run. A job_run is readable with activities:read
 * (activity/helpers.go:135-141).
 * While that job run is unfinished it has not recorded domainActivityId yet (the run's
 * outcome is written after the activity completes), so the answer is "pending" and the
 * activity is judged on a later poll.
 */
const SCHEDULER_TRIGGERS = new Set(['scheduled', 'recovery']);

/** 'scheduled' | 'manual' | 'pending' for a finished activity, given the env's job_run rows. */
export function runOrigin(activity, jobRuns) {
  const id = activity?.id == null ? '' : String(activity.id);
  const batch = str(activity?.batchId);
  let linked = false;
  let unfinished = false;
  for (const j of Array.isArray(jobRuns) ? jobRuns : []) {
    if (j?.type !== 'job_run') continue;
    const md = j.metadata && typeof j.metadata === 'object' ? j.metadata : {};
    if (id && md.domainActivityId === id) {
      if (SCHEDULER_TRIGGERS.has(md.trigger)) return 'scheduled';
      linked = true;
    } else if (batch && j.batchId === batch && !isTerminal(j)) {
      unfinished = true;
    }
  }
  return !linked && unfinished ? 'pending' : 'manual';
}

/** Summarise a finished auto_update activity using updater-history rows in its time window. */
export function summarizeUpdateRun(activity, historyRows) {
  const start = Date.parse(activity.startedAt);
  const end = Date.parse(activity.endedAt ?? activity.startedAt) + WINDOW_GRACE_MS;
  const updated = [];
  const failed = [];
  for (const row of Array.isArray(historyRows) ? historyRows : []) {
    const t = Date.parse(row?.createdAt);
    if (!(t >= start && t <= end)) continue;
    const name = str(row.resourceName);
    if (row.status === 'updated') {
      updated.push({ name, from: str(row.oldImageVersions?.main), to: str(row.newImageVersions?.main) });
    } else if (row.status === 'failed') {
      failed.push({ name, error: str(row.error).slice(0, ROW_ERROR_MAX) });
    }
  }
  const failure = activity.status === 'failed' && updated.length + failed.length === 0;
  return {
    id: activity.id,
    updated,
    failed,
    cronStatus: failure ? 'failure' : 'success',
    error: failure ? str(activity.error).slice(0, CRON_ERROR_MAX) : '',
  };
}

export function summarizePruneRun(activity) {
  const failure = activity.status === 'failed';
  return {
    id: activity.id,
    cronStatus: failure ? 'failure' : 'success',
    error: failure ? str(activity.error).slice(0, CRON_ERROR_MAX) : '',
  };
}
