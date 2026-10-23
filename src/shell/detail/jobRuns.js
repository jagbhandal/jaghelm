/**
 * What a job's detail says beyond its row (#578), the drawer's and the
 * phone's sheet's (entityExtras.js): when it last reported and the overdue
 * line, by the model's `lastRun`, `everySeconds` and `overdue`, and its last
 * runs, from /api/cron/status. Only the details load it.
 */
/** A span of seconds as the model's reasons say it (status/rules.js spanText): "15 min", "24 h", "7 d". */
export function spanWords(seconds) {
  const s = Math.max(0, seconds);
  if (s < 7200) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

/**
 * How long ago a job last reported, as the detail says it, in the overdue line's words: "45 s ago",
 * "12 min ago", "31 h ago", "3 d ago"; or null.
 */
export function lastReportAgo(entity, at) {
  if (!Number.isFinite(entity?.lastRun) || !Number.isFinite(at)) return null;
  const s = Math.max(0, (at - entity.lastRun) / 1000);
  return s < 60 ? `${Math.floor(s)} s ago` : `${spanWords(s)} ago`;
}

/**
 * The overdue line, the old Scheduled Jobs panel's (#578): for a job the
 * model says is overdue, "Last report 31 h ago · expected every 24 h", by the
 * status's clock; null otherwise.
 */
export function overdueLine(entity, at) {
  if (entity?.overdue !== true || !Number.isFinite(entity.lastRun) || !Number.isFinite(at))
    return null;
  const since = `Last report ${spanWords((at - entity.lastRun) / 1000)} ago`;
  return Number.isFinite(entity.everySeconds)
    ? `${since} · expected every ${spanWords(entity.everySeconds)}`
    : since;
}

const RUN_TIME = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** When a run reported, as the old panel said it: "Oct 15, 01:00"; null when unreadable. */
export function runTime(iso) {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? RUN_TIME.format(at) : null;
}

/** How long a run took: "48 s", "23 min", "23 min 5 s", "1 h 5 min"; null without a number. */
export function runDuration(seconds) {
  const n = Number(seconds);
  if (seconds == null || seconds === '' || !Number.isFinite(n) || n < 0) return null;
  const s = Math.round(n);
  if (s < 60) return `${s} s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
  const m = Math.floor((s % 3600) / 60);
  return m ? `${Math.floor(s / 3600)} h ${m} min` : `${Math.floor(s / 3600)} h`;
}

/**
 * The job's entry in /api/cron/status (`[{ node, jobs: [{ job, runs }] }]`),
 * or null: the one on its node by its name.
 */
export function cronEntryOf(body, entity) {
  if (!Array.isArray(body) || !entity) return null;
  const node = body.find((n) => n?.node === entity.node);
  return node?.jobs?.find?.((j) => j?.job === entity.name) ?? null;
}

/**
 * A job's last runs (up to the three the store keeps), newest first, as the
 * detail lists them: `{ key, state, word, time, duration, error }`. A run that
 * succeeded is OK; one that failed is the state the model gives the job for
 * a failed run (a job's is a warning, a backup's critical: spec §6.1), and
 * says its error; a run with no status has no signal.
 */
export function runsOf(entry, entity) {
  const failed = entity?.kind === 'backup' ? 'crit' : 'warn';
  return (Array.isArray(entry?.runs) ? entry.runs : []).slice(0, 3).map((run, i) => {
    const status = run?.status;
    const state = status === 'success' ? 'ok' : status === 'failure' ? failed : 'unknown';
    return {
      key: `${i}:${run?.timestamp ?? ''}`,
      state,
      word: state === 'ok' ? 'Succeeded' : state === 'unknown' ? 'No status' : 'Failed',
      time: runTime(run?.timestamp) ?? 'Unknown time',
      duration: runDuration(run?.duration_seconds),
      error: status === 'failure' && typeof run?.error === 'string' && run.error ? run.error : null,
    };
  });
}
