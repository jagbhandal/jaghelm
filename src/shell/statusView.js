/**
 * How the shell words the status model (#296). The server judges every state
 * (spec §6); these only count and phrase what it sent, for the header's Alerts
 * badge, the Alerts page's issue rows and the Overview's subsystem strip.
 */

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

/** Where an issue is: its kind, then its node when it has one ("Service · vm103"). */
export function whereOf(entity) {
  return [KIND[entity?.kind], entity?.node].filter(Boolean).join(' · ') || undefined;
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
 * list is ranked, worst first), or null with none, or while there is no
 * signal (the count would be stale).
 */
export function alertsBadge(status, reach) {
  const issues = reach === 'ok' ? (status?.issues ?? []) : [];
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
 */
export function subsystemCells(status) {
  return (status?.subsystems ?? [])
    .filter((s) => s.counts?.total > 0)
    .map((s) => ({
      key: s.id,
      label: s.name,
      state: s.state,
      word: subsystemWord(status, s),
      value: s.detail,
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
