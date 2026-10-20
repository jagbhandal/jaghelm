/**
 * How the shell words the status model (#296). The server judges every state
 * (spec §6); these only count and phrase what it sent, for the header's Alerts
 * badge and the Alerts page's issue rows.
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
