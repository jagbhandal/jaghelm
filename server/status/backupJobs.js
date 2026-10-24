// @ts-check
/**
 * Which cron jobs are backups (spec §6.2, #291): display-config.json's
 * `backupJobs`, a list of "node:job" keys as the Scheduled Jobs panel names a
 * job (the node and job a report sends to /api/cron/report). A job is a backup
 * only when this list names it, never by its name, so the same reports always
 * give the same board. A backup is judged by the backup rule (spec §6.1: failed
 * last run is crit, overdue is warn) in the Backups subsystem; every other job
 * stays in Jobs.
 *
 * Proxmox's vzdump results arrive as a cron job already: the PVE notification
 * webhook reports `proxmox-backup` on node `pve`, so "pve:proxmox-backup" marks
 * them. Settings → Nodes & Services edits the list (#319, a switch per job);
 * it can still be set by hand in the file, or with a POST to /api/display-config.
 */

// The cron route caps a node and a job name at 256 characters each.
const KEY_MAX = 256 + 1 + 256;
// How much of the dropped entries one log line shows.
const LOG_ENTRIES = 10;
const LOG_ENTRY_CHARS = 100;

/**
 * Whether `v` is a "node:job" key: a string with a node before its first colon
 * and a job after it, with no spaces around it.
 *
 * @param {unknown} v
 * @returns {v is string}
 */
function isJobKey(v) {
  if (typeof v !== 'string' || v.length > KEY_MAX || v.trim() !== v) return false;
  const colon = v.indexOf(':');
  return colon > 0 && colon < v.length - 1;
}

/**
 * The backup jobs a `backupJobs` value names, and what it holds that isn't one.
 * No value (undefined or null) is no backups. A value that isn't a list is
 * dropped whole; in a list, each entry that isn't a "node:job" string is
 * dropped and the others kept, in order, once each.
 *
 * @param {unknown} raw  display-config.json's `backupJobs`
 * @returns {{ jobs: string[], dropped: unknown[] }}
 */
export function resolveBackupJobs(raw) {
  if (raw === undefined || raw === null) return { jobs: [], dropped: [] };
  if (!Array.isArray(raw)) return { jobs: [], dropped: [raw] };
  const jobs = new Set();
  const dropped = [];
  for (const entry of raw) {
    if (isJobKey(entry)) jobs.add(entry);
    else dropped.push(entry);
  }
  return { jobs: [...jobs], dropped };
}

/** @param {unknown} v */
const shown = (v) => String(JSON.stringify(v)).slice(0, LOG_ENTRY_CHARS);

/**
 * Reads the backup jobs from a display config, once a cycle, and logs what it
 * drops once: a warning when the dropped entries change (a new mistake, or the
 * same one again after it was fixed), nothing while they stay the same.
 *
 * @param {{ logger: { warn: (fields: object, msg: string) => void } }} deps
 * @returns {(displayConfig: any) => string[]}
 */
export function createBackupJobsReader({ logger }) {
  /** @type {string | null} the dropped entries last logged, as JSON (null: none) */
  let logged = null;
  return (displayConfig) => {
    const { jobs, dropped } = resolveBackupJobs(displayConfig?.backupJobs);
    const now = dropped.length ? JSON.stringify(dropped) : null;
    if (now !== null && now !== logged) {
      logger.warn(
        { count: dropped.length, dropped: dropped.slice(0, LOG_ENTRIES).map(shown) },
        'display-config.json backupJobs: entries dropped; each must be a "node:job" string, as the Scheduled Jobs panel names the job. Those jobs stay jobs'
      );
    }
    logged = now;
    return jobs;
  };
}
