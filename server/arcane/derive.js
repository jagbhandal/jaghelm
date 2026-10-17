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
