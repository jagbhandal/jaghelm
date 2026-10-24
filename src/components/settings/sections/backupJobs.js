/**
 * Which cron jobs are backups, as Settings → Nodes & Services edits it (#319,
 * spec §6.2). The jobs are the ones that have reported (/api/cron/status:
 * `[{ node, jobs: [{ job }] }]`); the marks are display-config.json's
 * `backupJobs`, a list of "node:job" keys (server/status/backupJobs.js), the
 * same key the file has always had, now edited here instead of by hand. A key
 * that names a job nothing reports any more stays in the list, shown as "not
 * reporting", so it can still be unmarked.
 */

/** The "node:job" key the server reads, for a job a node reports. */
export const jobKey = (node, job) => `${node}:${job}`;

/**
 * The jobs to list, sorted by node and job: every job reporting and every
 * marked one: `{ key, node, job, backup, reporting }`. Entries of `marked`
 * that aren't "node:job" strings are left out (the server drops them too).
 */
export function backupRows(statuses, marked) {
  const keys = (Array.isArray(marked) ? marked : []).filter(
    (k) => typeof k === 'string' && k.indexOf(':') > 0 && k.indexOf(':') < k.length - 1
  );
  const on = new Set(keys);
  const rows = new Map();
  for (const n of Array.isArray(statuses) ? statuses : []) {
    for (const j of n?.jobs ?? []) {
      if (typeof n?.node !== 'string' || typeof j?.job !== 'string') continue;
      const key = jobKey(n.node, j.job);
      rows.set(key, { key, node: n.node, job: j.job, backup: on.has(key), reporting: true });
    }
  }
  for (const key of on) {
    if (rows.has(key)) continue;
    const colon = key.indexOf(':');
    rows.set(key, { key, node: key.slice(0, colon), job: key.slice(colon + 1), backup: true, reporting: false });
  }
  return [...rows.values()].sort(
    (a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : 0) || (a.job < b.job ? -1 : a.job > b.job ? 1 : 0)
  );
}

/** `marked` with `key` marked or unmarked: the valid keys in their order, once each. */
export function withBackup(marked, key, on) {
  const kept = (Array.isArray(marked) ? marked : []).filter(
    (k) => typeof k === 'string' && k !== key && k.indexOf(':') > 0 && k.indexOf(':') < k.length - 1
  );
  return on ? [...new Set([...kept, key])] : [...new Set(kept)];
}
