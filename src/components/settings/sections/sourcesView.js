/**
 * Settings → Sources (#318, spec §7): each source JagHelm reads, as its row,
 * from the status model alone (/api/status, docs/ARCHITECTURE.md §4.7). The
 * client judges nothing (spec §6):
 *
 *  - a source is what the model's `sources` says of it, `ok` or `failed`
 *    with its error, shown as the model words it, and `since` when; a failed
 *    one the model makes an issue of (`sources/<name>`) takes that issue's
 *    word, "Failed", "Failing" (Prometheus answering, failing for a node) or
 *    "Off" (a URL refused for holding a user or password, #419). A failed
 *    source is a warning (spec §6.1), so its lamp is `warn`.
 *  - a source the model doesn't list isn't set up: no lamp, and its row
 *    names the variable that sets it. A configured one always has a word.
 *  - the cron reporters are no source of the model: their row counts the
 *    jobs and backups that report (the cron store's entities, the kinds the
 *    Jobs section lists; named here, not imported from jobsView.js, so
 *    Settings' chunk doesn't split that section's) and the newest report's
 *    age, and takes its state from the model's Jobs and Backups subsystems,
 *    the worst of the two, with their words (statusView.js subsystemCells):
 *    "Reporting" only while both are ok. Its link opens where the Jobs
 *    section shows every kind that reports (jobsHref).
 *  - services.yaml is a source of the model too (#505), listed only while
 *    it can't be used: then it has a row of its own, first, with the model's
 *    words and a link to Nodes & Services, which edits it.

 * Every row names where its source is set: the variable in JagHelm's .env,
 * never its value (an address can carry a credential, #419). With a stale
 * status (statusFreshness.js, #480) every lamp is drawn as no signal and the
 * words stay as last known; before the first status a row has nothing to say
 * but that.
 */
import { agoText, durationText } from '../../../ui/lib/ago.js';
import { NO_SIGNAL, WORDS } from '../../../ui/lib/status.js';
import { drawnState } from '../../../shell/statusFreshness.js';
import { subsystemCells } from '../../../shell/statusView.js';

// The entities a cron reporter feeds: jobs, and jobs marked as backups.
const REPORTED = new Set(['job', 'backup']);

/** What a row says of where its source is set: the label before the variable. */
const SET_IN = 'Set in .env as';

/**
 * The sources, in the page's order: each one's id (its key in the model's
 * `sources`, and its row's anchor), its name, where it is set (the words
 * around its variable), and what its row says while it isn't set up. The UPS
 * is read through Prometheus, from a NUT server's metrics (refresh.js
 * upsQuery): JAGHELM_UPS_NAME only chooses one of several, the first by name
 * without it.
 */
export const SOURCES = Object.freeze([
  Object.freeze({
    id: 'prometheus',
    name: 'Prometheus',
    setting: Object.freeze({ label: SET_IN, variable: 'PROMETHEUS_URL' }),
    unset: 'Set PROMETHEUS_URL in .env, then restart JagHelm.',
  }),
  Object.freeze({
    id: 'kuma',
    name: 'Uptime Kuma',
    setting: Object.freeze({ label: SET_IN, variable: 'KUMA_URL' }),
    unset: 'Set KUMA_URL in .env, then restart JagHelm.',
  }),
  Object.freeze({
    id: 'nut',
    name: 'NUT (UPS)',
    setting: Object.freeze({ label: 'Picked in .env by', variable: 'JAGHELM_UPS_NAME' }),
    unset:
      "JagHelm reads the UPS through Prometheus: add your NUT server's metrics to Prometheus, then, with more than one UPS, set JAGHELM_UPS_NAME in .env to choose which.",
  }),
  Object.freeze({
    id: 'gitea',
    name: 'Gitea',
    setting: Object.freeze({ label: SET_IN, variable: 'JAGHELM_GITEA_URL' }),
    unset: 'Set JAGHELM_GITEA_URL in .env, then restart JagHelm.',
  }),
]);

/** The cron reporters' row: its anchor, its name, and the secret its reporters send. */
export const CRON = Object.freeze({
  id: 'cron-reporters',
  name: 'Cron reporters',
  setting: Object.freeze({
    label: 'Reporters send',
    variable: 'JAGHELM_CRON_SECRET',
    after: ', set in .env',
  }),
  unset:
    'No job has reported yet. A reporter sends each run to /api/cron/report with JAGHELM_CRON_SECRET from .env.',
});

/** services.yaml's row, while the model says it can't be used (#505, #536). */
export const CONFIG = Object.freeze({ id: 'config', name: 'services.yaml', setting: null });

/** What an answering source says. */
export const ANSWERING = 'Answering';
/** What a source the model doesn't list says. */
export const NOT_SET_UP = 'Not set up';
/** What the cron reporters say while their jobs and backups are all well. */
export const REPORTING = 'Reporting';
/** What services.yaml's row says while the model can't use it. */
export const CONFIG_FAILED = "Can't be read";

const sinceText = (since, at) =>
  Number.isFinite(since) && Number.isFinite(at) ? `for ${durationText(at - since)}` : null;

/** A row: the source's own parts, and what is said of it. */
const rowOf = (source, said) => ({
  id: source.id,
  name: source.name,
  setting: source.setting,
  state: null,
  word: null,
  since: null,
  error: null,
  detail: null,
  ...said,
});

/** A row while there is no status to read: no signal, and why. */
const unread = (source, freshness) =>
  rowOf(source, {
    state: 'unknown',
    word: WORDS.unknown,
    detail: freshness?.cause ?? NO_SIGNAL.waiting,
  });

/** A row whose source isn't set up: no lamp, no setting, and what to set. */
const notSetUp = (source) =>
  rowOf(source, { setting: null, word: NOT_SET_UP, detail: source.unset });

/**
 * The four sources' rows, `[{ id, name, setting, state, word, since, error,
 * detail }]`: `state` the lamp as drawn (null for one not set up, which has no
 * `setting` either), `since` "for 4 min" by the status's clock `at`, `error`
 * the model's, on failure.
 *
 * @param {{ status: any, freshness?: { stale?: boolean, cause?: string } | null, at?: number | null }} args
 */
export function sourceRows({ status, freshness = null, at = null }) {
  return SOURCES.map((source) => {
    if (!status) return unread(source, freshness);
    const entry = status.sources?.[source.id];
    if (!entry) return notSetUp(source);
    const failed = entry.state !== 'ok';
    const issue = (status.issues ?? []).find((i) => i.id === `sources/${source.id}`);
    return rowOf(source, {
      state: drawnState(failed ? 'warn' : 'ok', freshness),
      word: failed ? issue?.word || 'Failed' : ANSWERING,
      since: sinceText(entry.since, at),
      error: failed ? entry.error || issue?.reason || null : null,
    });
  });
}

/**
 * services.yaml's row, first, while the model's `sources.config` is failed
 * (it is listed only then): the model's error as it gives it, and a link to
 * `href`, Nodes & Services, which edits the file. Null otherwise.
 *
 * @param {{ status: any, freshness?: { stale?: boolean } | null, at?: number | null, href: string }} args
 */
export function configRow({ status, freshness = null, at = null, href }) {
  const entry = status?.sources?.config;
  if (!entry || entry.state === 'ok') return null;
  const issue = (status.issues ?? []).find((i) => i.id === 'sources/config');
  return rowOf(CONFIG, {
    state: drawnState('warn', freshness),
    word: CONFIG_FAILED,
    since: sinceText(entry.since, at),
    error: entry.error || issue?.reason || null,
    link: { href, label: 'Open Nodes & Services' },
  });
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "3 jobs report", "1 backup reports", "3 jobs and 1 backup report". */
function reportersText(jobs, backups) {
  const said = [
    jobs && plural(jobs, 'job', 'jobs'),
    backups && plural(backups, 'backup', 'backups'),
  ]
    .filter(Boolean)
    .join(' and ');
  return `${said} ${jobs + backups === 1 ? 'reports' : 'report'}`;
}

// Worst-of order (spec §6.1), for the worse of the two subsystems.
const RANK = { ok: 0, maintenance: 1, unknown: 2, warn: 3, crit: 4 };

/**
 * The cron reporters' row, as the sources' (`link` too, `{ href, label }`):
 * how many jobs and backups report and the newest report's age, by the
 * status's clock; its state the worse of the model's Jobs and Backups
 * subsystems, its word "Reporting" while that is ok, else the model's word
 * for it ("Overdue", "Failed"), and a line per subsystem with a problem in
 * the model's words ("Backups: 1 failed"). The link opens where every kind
 * that reports is shown: `jobsHref(subsystem)`, the Jobs section filtered to
 * `jobs` or `backups` when only that kind reports, else (null) unfiltered,
 * so a failed backup is never behind a link that shows only jobs.
 *
 * @param {{ status: any, freshness?: { stale?: boolean, cause?: string } | null, at?: number | null, jobsHref: (subsystem: string | null) => string }} args
 */
export function cronRow({ status, freshness = null, at = null, jobsHref }) {
  if (!status) return unread(CRON, freshness);
  const reports = (status.entities ?? []).filter((e) => REPORTED.has(e?.kind));
  if (reports.length === 0) return notSetUp(CRON);
  const jobs = reports.filter((e) => e.kind === 'job').length;
  const backups = reports.length - jobs;
  const runs = reports.map((e) => e.lastRun).filter(Number.isFinite);
  const newest = runs.length > 0 && Number.isFinite(at) ? Math.max(...runs) : null;
  const cells = subsystemCells(status, null).filter((c) => c.key === 'jobs' || c.key === 'backups');
  const worst = cells.reduce((w, c) => (w && RANK[w.state] >= RANK[c.state] ? w : c), null);
  const level = worst?.state ?? 'unknown';
  const problems = cells
    .filter((c) => c.state !== 'ok')
    .map((c) => `${c.label}: ${c.sub ?? c.value}`);
  const only = jobs === 0 ? 'backups' : backups === 0 ? 'jobs' : null;
  return rowOf(CRON, {
    state: drawnState(level, freshness),
    word: level === 'ok' ? REPORTING : worst?.word || WORDS[level],
    detail: [
      [reportersText(jobs, backups), newest != null && `newest ${agoText(at - newest)}`]
        .filter(Boolean)
        .join(' · '),
      ...problems,
    ],
    link: {
      href: jobsHref(only),
      label:
        only === 'backups'
          ? 'Open Backups'
          : only === 'jobs'
            ? 'Open Jobs'
            : 'Open Jobs and Backups',
    },
  });
}
