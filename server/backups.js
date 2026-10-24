/**
 * What GET /api/backups serves (#675): the Overview's Backups section.
 *
 * Part 1, per backup job: the jobs `backupJobs` (display-config.json, the same
 * list the Backups subsystem uses) names, read from the cron store the
 * reporters already write to: the Proxmox vzdump webhooks (`pve:proxmox-backup`),
 * vm-103's `vm103-backup.sh` and the NAS rclone job. The store keeps the last 3
 * runs of a job, so "last good run" is the newest success among those; a job
 * whose last 3 runs all failed has none. A job nobody has reported yet is
 * `seen: false`, which the section reads as unknown, never as fine. The
 * server judges no age: it gives the times, and the web draws them against the
 * lines Settings keeps (`backupAgeHours`).
 *
 * `hostDown` says the board knows the job's host (by its name, or the alias for
 * a hostname the board names differently) and reports it unreachable. Only then
 * does the web cap an old report at amber: the NAS or MS-S1 may simply be off.
 * An unknown host is not assumed down. A reported failure is a failure
 * whatever the host.
 *
 * Part 2, the B2 bucket: b2.js's saved samples (no request is made here).
 *
 * Nothing here alerts. The Proxmox webhook carries one result per job, not per
 * guest, so there is no per-guest row.
 */
import { getCached } from './cache.js';
import { b2Answer } from './b2.js';
import { getAllStatuses } from './cron-store.js';
import { readDisplayConfig } from './refresh.js';
import { resolveBackupJobs } from './status/backupJobs.js';

const ERROR_MAX = 160;
// A reporter's hostname (`hostname -s`) that is not the board's node key.
const NODE_ALIAS = Object.freeze({ 'docker-brain': 'vm103' });

const plain = (text) =>
  String(text)
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function cut(text, max) {
  const t = plain(text);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * @param {{ statuses?: any[], config?: any, services?: any, b2?: any }} [deps]
 */
export function backupsAnswer({
  statuses = getAllStatuses(),
  config = readDisplayConfig(),
  services = getCached('services'),
  b2 = b2Answer(),
} = {}) {
  const { jobs: keys } = resolveBackupJobs(config?.backupJobs);
  const nodes = services?.nodes && typeof services.nodes === 'object' ? services.nodes : {};
  const byKey = new Map(Object.entries(nodes).map(([k, n]) => [k.toLowerCase(), n]));
  // Known unreachable: the board has the node (by the reporter's name, or the
  // board's name for it) and says it is not reachable. Unknown is not down.
  const hostDownOf = (node) => {
    const n = byKey.get(node.toLowerCase()) ?? byKey.get(NODE_ALIAS[node.toLowerCase()] ?? '');
    return n?.reachable === false;
  };
  const runsOf = (node, job) =>
    statuses.find((n) => n.node === node)?.jobs.find((j) => j.job === job)?.runs ?? [];

  const jobs = keys.map((key) => {
    const colon = key.indexOf(':');
    const node = key.slice(0, colon);
    const job = key.slice(colon + 1);
    const runs = runsOf(node, job);
    const last = runs[0];
    const good = runs.find((r) => r.status === 'success');
    const lastAt = last ? Date.parse(last.timestamp) : NaN;
    const goodAt = good ? Date.parse(good.timestamp) : NaN;
    return {
      key,
      node,
      job,
      seen: Number.isFinite(lastAt),
      hostDown: hostDownOf(node),
      last: Number.isFinite(lastAt)
        ? {
            at: lastAt,
            status: last.status === 'success' ? 'success' : 'failure',
            ...(last.status !== 'success' && last.error && { error: cut(last.error, ERROR_MAX) }),
          }
        : null,
      lastGood: Number.isFinite(goodAt) ? goodAt : null,
      failedRuns: runs.filter((r) => r.status !== 'success').length,
      runs: runs.length,
    };
  });
  jobs.sort((a, b) => a.node.localeCompare(b.node) || a.job.localeCompare(b.job));
  return { jobs, b2 };
}
