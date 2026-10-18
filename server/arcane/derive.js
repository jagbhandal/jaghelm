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
 * A container's update state from Arcane's stored check (updateInfo):
 *   'pending' - hasUpdate is true;
 *   'current' - checked, no update, no error (up to date);
 *   'unknown' - never checked (no updateInfo) or the check errored. Arcane keeps the
 *     previous result only on a registry 429 (imageupdate/service.go:1143-1153); any other
 *     registry failure is saved as an error result with hasUpdate false (:522-535, :1104-1120)
 *     and surfaces as updateInfo.error (imageupdate/model.go:83). It must not read as
 *     "up to date".
 */
export function containerState(c) {
  const info = c?.updateInfo;
  if (!info || typeof info !== 'object') return 'unknown';
  if (info.hasUpdate === true) return 'pending';
  return str(info.error) ? 'unknown' : 'current';
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The next held-back set and pending map for one environment, from its unfiltered
 * container list. A container in the 'unknown' state keeps what it had: a held-back
 * entry is carried forward unchanged and so is its pending latest. Only 'current'
 * (up to date) or no longer listed clears an entry.
 */
export function nextUpdateState({ containers, checkOnly, prevHeld, prevPending }) {
  const list = Array.isArray(containers) ? containers : [];
  const unknown = new Set();
  for (const c of list) {
    const name = containerName(c);
    if (name && containerState(c) === 'unknown') unknown.add(name);
  }
  const held = heldBackSet(list, { checkOnly });
  const heldNames = new Set(held.map((e) => e.name));
  for (const e of Array.isArray(prevHeld) ? prevHeld : []) {
    if (unknown.has(e.name) && !heldNames.has(e.name)) {
      held.push({ ...e });
      heldNames.add(e.name);
    }
  }
  const pending = pendingMap(list);
  if (prevPending) {
    for (const name of unknown) {
      if (!pending.has(name) && prevPending.has(name)) pending.set(name, prevPending.get(name));
    }
  }
  return {
    held: held.sort(byName),
    pending: new Map([...pending].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
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

/*
 * Who started a finished image_update_check (the image watcher's check). Arcane v2.16.1
 * runs it in three ways, all with the same activity type:
 *   - Through the job runner (job "image-polling"): on the POLLING schedule ("scheduled",
 *     or "recovery" for a late slot), when the watcher wakes on its own (trigger "watcher":
 *     at startup and, if enabled, on Docker image events), or from the Jobs page's
 *     "Run now" ("manual"). The workflow instance is bound to the run, so the activity id
 *     is image-check-<run id>-<attempt> and its batchId is the run id
 *     (scheduler/flow/flow.go startInstance; scheduler/image_update_watcher.go).
 *   - Directly, from the Check Updates button or the image-updates API
 *     (imageupdate/handler.go CheckImages): unbound, id image-check-<uuid>, no batchId.
 * Only a "manual" image-polling run gets a job_run summary (job/service.go ActivityID); a
 * scheduled or watcher run has none. A run delivered from the manager to an agent keeps
 * its run id (job/children/remote/service.go), so its job_run on the manager shares the
 * batchId from the start, and its trigger is recorded when the job run is created.
 * So: unbound is manual; bound with a job_run is judged by that job_run's trigger; bound
 * without one was started by the scheduler or the watcher. The two cannot be told apart
 * through activities:read, so a watcher run counts as scheduled.
 */
const BOUND_CHECK_RE = /^image-check-(.+)-\d+$/;

/** 'scheduled' | 'manual' for a finished image_update_check, given the env's job_run rows. */
export function checkOrigin(activity, jobRuns) {
  const id = activity?.id == null ? '' : String(activity.id);
  const batch = str(activity?.batchId);
  const m = BOUND_CHECK_RE.exec(id);
  if (!batch || !m || m[1] !== batch) return 'manual';
  for (const j of Array.isArray(jobRuns) ? jobRuns : []) {
    if (j?.type !== 'job_run') continue;
    const md = j.metadata && typeof j.metadata === 'object' ? j.metadata : {};
    if (md.domainActivityId === id || j.batchId === batch) {
      return SCHEDULER_TRIGGERS.has(md.trigger) ? 'scheduled' : 'manual';
    }
  }
  return 'scheduled';
}

// The check's own summary (imageupdate/service.go finalizeImageCheckInternal). Arcane
// marks a check failed when any image errored; it reaches this summary even then.
const CHECK_SUMMARY_RE = /^Image update check completed: (\d+) checked, (\d+) errors\b/;

/**
 * Cron outcome of a finished image_update_check. Like an update run, a check is a failure
 * only when nothing came of it: it failed before its summary, or every image errored.
 * Some images erroring (a registry outage, a private image) is a success; those
 * containers already keep their held-back state silently (nextUpdateState).
 */
export function summarizeCheckRun(activity) {
  if (activity.status !== 'failed') return { id: activity.id, cronStatus: 'success', error: '' };
  const m =
    CHECK_SUMMARY_RE.exec(str(activity.latestMessage)) || CHECK_SUMMARY_RE.exec(str(activity.error));
  if (m && Number(m[1]) > Number(m[2])) {
    return { id: activity.id, cronStatus: 'success', error: '' };
  }
  return {
    id: activity.id,
    cronStatus: 'failure',
    error: str(activity.error).slice(0, CRON_ERROR_MAX),
  };
}

/**
 * Summarise a finished auto_update activity using updater-history rows in its time window:
 * [startedAt, endedAt + 60 s], ending before `until` (the next same-type run's startedAt,
 * in ms) when that is sooner. History rows carry no run id, so the cap is what gives each
 * row to at most one run when runs follow each other closely.
 */
export function summarizeUpdateRun(activity, historyRows, { until } = {}) {
  const start = Date.parse(activity.startedAt);
  const end = Date.parse(activity.endedAt ?? activity.startedAt) + WINDOW_GRACE_MS;
  const capped = typeof until === 'number' && Number.isFinite(until);
  const updated = [];
  const failed = [];
  for (const row of Array.isArray(historyRows) ? historyRows : []) {
    const t = Date.parse(row?.createdAt);
    if (!(t >= start && t <= end)) continue;
    if (capped && t >= until) continue;
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
