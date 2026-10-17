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

/** Containers with a pending update that Arcane will not apply on its own. */
export function heldBackSet(containers, { checkOnly }) {
  const out = [];
  for (const c of Array.isArray(containers) ? containers : []) {
    const info = c?.updateInfo;
    if (info?.hasUpdate !== true) continue;
    if (!(c.autoUpdateEnabled === false || checkOnly)) continue;
    const name = str(c.names?.[0]).replace(/^\//, '');
    if (!name) continue;
    out.push({
      name,
      current: str(info.currentVersion) || str(info.currentDigest).slice(0, 19),
      latest: str(info.latestVersion) || str(info.latestDigest).slice(0, 19),
    });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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
