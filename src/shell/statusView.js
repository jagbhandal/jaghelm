/**
 * How the shell words the status model (#296). The server judges every state
 * (spec §6); these only count and phrase what it sent, for the header's Alerts
 * badge, the Alerts page's issue rows and the Overview's subsystem strip,
 * and what a stale status last said (#480).
 */
import { EMPTY, EMPTY_SENTENCE, WORDS, toState } from '../ui/lib/status.js';
import { drawnState, lastKnownCaption } from './statusFreshness.js';

/** The noun before an issue's node, by the entity's kind (docs/ARCHITECTURE.md §4.7). */
const KIND = Object.freeze({
  service: 'Service',
  container: 'Container',
  node: 'Node',
  ups: 'Power',
  job: 'Job',
  backup: 'Backup',
  integration: 'Integration',
  agent: 'Arcane agent',
  source: 'Monitoring source',
});

// services.yaml as a source (#505) is JagHelm's own configuration, not a monitoring source.
const PLACE = Object.freeze({ 'sources/config': 'Configuration' });

/**
 * Where an issue is: its kind, then its node when it has one ("Service ·
 * vm103"); a source with a place of its own says that ("Configuration").
 */
export function whereOf(entity) {
  const kind = (entity?.id && PLACE[entity.id]) || KIND[entity?.kind];
  return [kind, entity?.node].filter(Boolean).join(' · ') || undefined;
}

/** A short age, as an issue row shows it: "30 s", "4 m", "3 h", "2 d". */
export function ageText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** The status model's issues as IssueRow `issue`s, aged against `now`. */
export function issueRows(status, now = Date.now()) {
  return (status?.issues ?? []).map((e) => ({
    id: e.id,
    state: e.state,
    word: e.word,
    title: e.name,
    where: whereOf(e),
    reason: e.reason,
    age: Number.isFinite(e.since) ? ageText(now - e.since) : undefined,
  }));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The issues counted by state: "2 critical, 2 warnings, 1 no signal". */
export function countsText(issues = []) {
  const n = (state) => issues.filter((i) => i.state === state).length;
  return [
    n('crit') && `${n('crit')} critical`,
    n('warn') && plural(n('warn'), 'warning', 'warnings'),
    n('unknown') && `${n('unknown')} no signal`,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * The Alerts entry's badge: how many issues, in the worst one's colour (the
 * list is ranked, worst first), or null with none, or while the status is
 * `stale` (useStatusStale: the count would be old).
 */
export function alertsBadge(status, stale) {
  const issues = stale ? [] : (status?.issues ?? []);
  if (issues.length === 0) return null;
  return {
    count: issues.length,
    state: issues[0].state,
    label: plural(issues.length, 'issue', 'issues'),
  };
}

/**
 * A subsystem's word: the model's word for its worst entity (the first of its
 * ranked issues in that state, else the first entity in it), as the strip's
 * lamp names it ("Down", "On battery", "Healthy"). The model gives a subsystem
 * a state, not a word, and the word for a state is its entity's.
 */
function subsystemWord(status, subsystem) {
  const match = (e) => e.subsystem === subsystem.id && e.state === subsystem.state;
  return (status.issues?.find(match) ?? status.entities?.find(match))?.word;
}

/**
 * The model's subsystems as SubsystemStrip cells (#298, spec §8 item 2), in
 * the model's order: one per subsystem with anything in it (an unconfigured
 * one shows no panel, spec §8), its state, word and the model's `detail`
 * ("11 / 12 up") as the value. None on an empty board.
 *
 * With a stale status (`freshness`, statusFreshness.js, #480), each cell
 * keeps its word and counts, as last known, but is drawn as no signal, and
 * says so under its count ("Last known 3 min ago").
 */
export function subsystemCells(status, freshness) {
  return (status?.subsystems ?? [])
    .filter((s) => s.counts?.total > 0)
    .map((s) => ({
      key: s.id,
      label: s.name,
      state: drawnState(s.state, freshness),
      word: subsystemWord(status, s),
      value: s.detail,
      sub: freshness?.stale ? lastKnownCaption(freshness) : undefined,
    }));
}

/**
 * The subsystem the Overview is filtered to, `{ id, name, detail }` (the
 * model's), when `id` names one the strip shows; otherwise null, and the
 * Overview shows everything.
 */
export function subsystemFilter(status, id) {
  if (!id) return null;
  const s = (status?.subsystems ?? []).find((x) => x.id === id && x.counts?.total > 0);
  return s ? { id: s.id, name: s.name, detail: s.detail } : null;
}

/**
 * What a status said at its top, as a stale screen quotes it: "All systems
 * normal", "Nothing monitored yet", or its word and counts ("Critical · 2
 * critical, 1 warning").
 */
export function headlineOf(status) {
  const state = status?.overall?.state;
  const issues = status?.issues ?? [];
  if (issues.length === 0 && state === EMPTY) return status.overall.sentence || EMPTY_SENTENCE;
  if (issues.length === 0 && (state === 'ok' || state === 'maintenance')) {
    return 'All systems normal';
  }
  const word = WORDS[toState(state)];
  const counts = countsText(issues);
  return counts ? `${word} · ${counts}` : word;
}

/**
 * "last known 3 min ago: All systems normal": what the header and the
 * attention panel say after "No signal", the same words in both; null while
 * fresh, or with nothing known.
 */
export function lastKnownLine(freshness, status) {
  if (!freshness?.stale || !freshness.lastKnown || !status) return null;
  return `${freshness.lastKnown}: ${headlineOf(status)}`;
}
