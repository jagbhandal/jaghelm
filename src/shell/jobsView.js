/**
 * The scheduled jobs and backups as the Overview's Jobs section and the
 * phone's list draw them (#578), from the status model alone (/api/status,
 * docs/ARCHITECTURE.md §4.7): each job's and backup's entity carries its
 * state, word and reason, and beside them its schedule in words, the
 * interval it is expected at, when it last reported and whether it is
 * overdue. The client judges nothing (spec §6): the lamp, the
 * word and the overdue flag are the model's, by the one severity table (a
 * failed job is a warning, a failed backup critical; ADR 0006).
 *
 * A row: its lamp, its name, its node, the schedule in words ("daily at
 * 03:00") while it is well, else the model's reason ("Overdue: no report on
 * schedule (expected every 24 h)"), and how long ago it last reported, by
 * the status's clock. Rows are listed by node, then by name, as the old
 * board's Scheduled Jobs panel listed them; jobs and backups in two groups,
 * each counted as the model counts its subsystem ("3 / 3 OK").
 *
 * With a stale status (statusFreshness.js, #480), every row is drawn as no
 * signal, keeping its words as last known, and the section's count says how
 * old they are.
 */
import { drawnState } from './statusFreshness.js';
import { ageText } from './statusView.js';

/** The entity kinds the section lists, each with its group. */
const GROUPS = Object.freeze([
  { key: 'jobs', kind: 'job', title: 'Jobs' },
  { key: 'backups', kind: 'backup', title: 'Backups' },
]);
const KINDS = new Set(GROUPS.map((g) => g.kind));

/** Whether `entity` is a job or a backup. */
export const isJob = (entity) => KINDS.has(entity?.kind);

/**
 * How long ago a job last reported, by the status's clock, as a row's meta
 * says it, short as an issue row's age: "4 m ago", "3 h ago", "2 d ago"; or
 * null.
 */
export function lastRunAgo(entity, at) {
  if (!Number.isFinite(entity?.lastRun) || !Number.isFinite(at)) return null;
  return `${ageText(at - entity.lastRun)} ago`;
}

const byPlace = (a, b) => a.node.localeCompare(b.node) || a.name.localeCompare(b.name);

/**
 * Each job and backup the model has, as its row: `{ id, kind, name, node,
 * where, level, state, word, detail, meta, muted }`, by node then name. `level` is
 * the model's state, `state` the one drawn (no signal while stale). `hidden`
 * leaves out the ids a Remove took off (removedJobs.js) before the model
 * has dropped them.
 *
 * @param {{ status: any, freshness?: { stale?: boolean } | null, at?: number | null,
 *   hidden?: (entity: any) => boolean }} args
 */
export function jobRows({ status, freshness = null, at = null, hidden = () => false }) {
  return (status?.entities ?? [])
    .filter((e) => isJob(e) && !hidden(e))
    .map((e) => {
      const well = e.state === 'ok';
      return {
        id: e.id,
        kind: e.kind,
        name: e.name || e.id,
        node: e.node ?? '',
        where: e.node ?? null,
        level: e.state,
        state: drawnState(e.state, freshness),
        word: e.word,
        detail: well ? (e.schedule ?? e.reason) : e.reason,
        meta: lastRunAgo(e, at) ?? '—',
        muted: true,
      };
    })
    .sort(byPlace);
}

/**
 * The rows in their groups, `[{ key, title, count, rows }]`: Jobs, then
 * Backups, as the model orders its subsystems, each counted by the model
 * ("3 / 3 OK"); a group with no row left out. `filter`, the Overview's
 * subsystem filter (`jobs`, `backups`), keeps its own group alone.
 */
export function jobGroups(rows, { status = null, filter = null } = {}) {
  return GROUPS.filter((g) => !filter || filter === g.key)
    .map((g) => ({
      key: g.key,
      title: g.title,
      count: status?.subsystems?.find((s) => s.id === g.key)?.detail ?? null,
      rows: rows.filter((r) => r.kind === g.kind),
    }))
    .filter((g) => g.rows.length > 0);
}

// The model's levels, worst first, as the section's count names them.
const RANK = ['crit', 'warn', 'unknown', 'maintenance'];

/**
 * The section's count: "8 scheduled · all OK", "8 scheduled · 1 failed · 1
 * overdue" (each failing kind by its word, worst first); with a stale
 * status, how old it is instead: "8 scheduled · No signal · last known 3 min
 * ago".
 */
export function jobsCount(rows, freshness = null) {
  const first = `${rows.length} scheduled`;
  if (freshness?.stale) return [first, freshness.note].filter(Boolean).join(' · ');
  const counts = new Map();
  for (const level of RANK) {
    for (const r of rows.filter((x) => x.level === level)) {
      const word = level === 'maintenance' ? 'in maintenance' : String(r.word || '').toLowerCase();
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const parts = [...counts].map(([word, n]) => `${n} ${word}`);
  return [first, ...(parts.length ? parts : ['all OK'])].join(' · ');
}
