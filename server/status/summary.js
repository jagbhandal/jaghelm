/**
 * The status model's summary (spec §6, #290): the subsystems with their
 * worst-of state and counts, the ranked issue list, and the overall state and
 * sentence. Pure: it reads only the entities and source issues it is given.
 */
import { worstOf } from './rules.js';
import { CONTAINERS_SOURCE } from './containerBlind.js';

/**
 * The overall state of an empty board (#449): nothing is set up, and every
 * read that ran answered (the model decides, model.js isEmptyBoard). It is the
 * board's alone, never an entity's or a subsystem's, so it is none of the five
 * STATES: not ok, since nobody checked anything, and not unknown, since
 * nothing went silent. It is never an issue and push sends nothing for it
 * (there is nothing to page about); a client shows it as the quiet line,
 * saying the sentence, "Nothing monitored yet". src/ui/lib/status.js names it
 * the same (a test keeps them in step).
 */
export const EMPTY = 'empty';

/** The six subsystems, in the order the strip shows them (spec §6). */
export const SUBSYSTEMS = Object.freeze([
  { id: 'services', name: 'Services' },
  { id: 'nodes', name: 'Nodes' },
  { id: 'power', name: 'Power' },
  { id: 'jobs', name: 'Jobs' },
  { id: 'backups', name: 'Backups' },
  { id: 'integrations', name: 'Integrations' },
]);

// Issue ranking within a level: a failed monitoring source first (it explains
// the "no signal" rows under it), then the subsystems in strip order.
const ORDER = { sources: 0, services: 1, nodes: 2, power: 3, jobs: 4, backups: 5, integrations: 6 };
const LEVEL = { crit: 0, warn: 1, unknown: 2 };

/** Whether an entity in `state` is an issue: maintenance and ok are not (spec §6.1). */
export function isIssue(state) {
  return Object.hasOwn(LEVEL, state);
}

/**
 * The issue list, ranked (spec §6): crit before warn before unknown; within a
 * level by subsystem order (failed sources first), then by age, oldest first,
 * so a new issue joins the end of its group rather than reshuffling the rows
 * above it; then by id, so equal issues keep one order.
 */
export function rankIssues(issues) {
  const since = (i) => (Number.isFinite(i.since) ? i.since : Infinity);
  return [...issues].sort(
    (a, b) =>
      LEVEL[a.state] - LEVEL[b.state] ||
      (ORDER[a.subsystem] ?? 99) - (ORDER[b.subsystem] ?? 99) ||
      since(a) - since(b) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

const OK_WORD = { services: 'up', nodes: 'healthy' };

function countsOf(members) {
  const counts = { total: members.length, ok: 0, warn: 0, crit: 0, unknown: 0, maintenance: 0 };
  for (const e of members) counts[e.state] += 1;
  return counts;
}

// How a status word reads after a count ("1 node in warning", "1 in warning").
const PHRASE = {
  Warning: 'in warning',
  'Login refused': 'with a refused login',
  'Restart loop': 'in a restart loop',
  'OOM killed': 'OOM killed',
};
const said = (word) => PHRASE[word] ?? word.toLowerCase();
const LOUD_WORD = { crit: 'Critical', warn: 'Warning' };

/** What a count's line says after its first part: "1 in maintenance", "1 no signal". */
function quietParts(counts) {
  const parts = [];
  if (counts.maintenance) parts.push(`${counts.maintenance} in maintenance`);
  if (counts.unknown) parts.push(`${counts.unknown} no signal`);
  return parts;
}

/**
 * A subsystem's problems, each word with its count, worst first (the issue
 * ranking, rankIssues): "1 down", "2 overdue", "1 in warning", "1 with a
 * refused login". None when no member is critical or in warning.
 */
function problemsOf(members) {
  const counted = new Map();
  for (const e of rankIssues(members.filter((m) => m.state === 'crit' || m.state === 'warn'))) {
    const word = said(e.word || LOUD_WORD[e.state]);
    counted.set(word, (counted.get(word) ?? 0) + 1);
  }
  return [...counted].map(([word, n]) => `${n} ${word}`);
}

/**
 * "31 / 32 up · 1 in maintenance": the tile's value (tileOf) and the OK
 * word, then what is in maintenance and has no signal, the counts the tile
 * says; the UPS on its own, its reason ("On battery (64 % charge)"); "None"
 * for an empty subsystem. The header's sentence and push read it.
 */
function detailOf(id, counts, members) {
  if (counts.total === 0) return 'None';
  if (id === 'power' && members.length === 1) {
    const parts = [members[0].reason];
    if (counts.maintenance) parts.push(`${counts.maintenance} in maintenance`);
    return parts.join(' · ');
  }
  const { value } = tileOf(id, counts, members);
  return [`${value} ${OK_WORD[id] ?? 'OK'}`, ...quietParts(counts)].join(' · ');
}

/**
 * A subsystem's tile (#541), from its counts: a short `value`, the strip's
 * big line, and the `sub` under it. A count's value is "31 / 32". Its sub
 * names what is wrong, worst first ("1 down", "1 overdue", problemsOf), or,
 * with nothing wrong, the OK word ("up"); then what is in maintenance and
 * has no signal ("1 down · 1 no signal", "up · 1 in maintenance"). The OK
 * word never sits on a tile with a problem. The UPS's value is its word ("On
 * mains", "On battery") and its sub its charge ("64 % charge"), else its
 * reason when that says more than the word ("No data: Prometheus
 * unreachable"), else nothing. An empty subsystem is "None" with no sub.
 * Clients draw both as they are and split no string.
 */
function tileOf(id, counts, members) {
  if (counts.total === 0) return { value: 'None', sub: '' };
  if (id === 'power' && members.length === 1) {
    const [ups] = members;
    const value = ups.word || ups.reason;
    if (ups.metric?.name === 'charge') return { value, sub: `${ups.metric.value} % charge` };
    return { value, sub: ups.reason && ups.reason !== value ? ups.reason : '' };
  }
  const problems = problemsOf(members);
  const first = problems.length ? problems : [OK_WORD[id] ?? 'OK'];
  return {
    value: `${counts.ok} / ${counts.total}`,
    sub: [...first, ...quietParts(counts)].join(' · '),
  };
}

/**
 * Each subsystem's worst-of state, counts by state, one-line detail and its
 * tile's value and sub (tileOf). An empty one (nothing of that kind is set
 * up) is ok with a total of 0, and a client shows no panel for it (spec §8:
 * unconfigured sources render none).
 */
export function subsystemsOf(entities) {
  return SUBSYSTEMS.map(({ id, name }) => {
    const members = entities.filter((e) => e.subsystem === id);
    const counts = countsOf(members);
    return {
      id,
      name,
      state: worstOf(members.map((e) => e.state)),
      counts,
      detail: detailOf(id, counts, members),
      ...tileOf(id, counts, members),
    };
  });
}

const NOUNS = {
  service: ['service', 'services'],
  container: ['container', 'containers'],
  node: ['node', 'nodes'],
  job: ['job', 'jobs'],
  backup: ['backup', 'backups'],
  integration: ['integration', 'integrations'],
  agent: ['Arcane agent', 'Arcane agents'],
};
const noun = (kind, n) => (NOUNS[kind] ?? ['item', 'items'])[n === 1 ? 0 : 1];

const SOURCE_PHRASE = { Failing: 'failing', Off: 'off' };

function phrase(issue, n) {
  // services.yaml that is no usable config (#505) says why: "services.yaml doesn't parse (line 4)".
  if (issue.id === 'sources/config') return issue.reason;
  // A source that answers but fails for part of what it feeds (#476) is failing, not unreachable;
  // one whose URL is refused (#419) is off.
  if (issue.id.startsWith(`sources/${CONTAINERS_SOURCE}`)) return `${issue.name} missing`;
  if (issue.kind === 'source')
    return `${issue.name} ${Object.hasOwn(SOURCE_PHRASE, issue.word) ? SOURCE_PHRASE[issue.word] : 'unreachable'}`;
  if (issue.kind === 'ups') return `UPS ${issue.word.toLowerCase()}`;
  // A stack's row says which member failed (#642): "Immich Redis is down".
  if (issue.stack?.rollup?.member) return n === 1 ? issue.reason : `${n} stacks degraded`;
  return `${n} ${noun(issue.kind, n)} ${said(issue.word)}`;
}

/**
 * The overall sentence (spec §6, §8):
 *
 * - With nothing on the board (EMPTY, or unknown): "Nothing monitored yet".
 * - With warnings or worse: each kind of problem with its count, in issue
 *   order ("2 services down · UPS on battery"), a failed source by name
 *   ("Prometheus unreachable", or "Prometheus failing" when it answers but
 *   fails for a node, or "Kuma off" when its URL is refused, #419; a broken
 *   services.yaml by its reason, "services.yaml doesn't parse (line 4)",
 *   #505), then "N no signal".
 * - Otherwise, with entities in no signal: the quiet line breaks
 *   ("31 up · 1 no signal").
 * - Otherwise the quiet line ("All 32 services up · 6 nodes healthy").
 *   Maintenance doesn't break it; it shows in the subsystem detail.
 */
export function sentenceOf(ranked, entities, subsystems) {
  if (entities.length === 0 && ranked.length === 0) return 'Nothing monitored yet';
  const loud = ranked.filter((i) => i.state === 'crit' || i.state === 'warn');
  const unknown = ranked.filter((i) => i.state === 'unknown').length;
  const services = subsystems.find((s) => s.id === 'services').counts;
  const nodes = subsystems.find((s) => s.id === 'nodes').counts;
  if (loud.length > 0) {
    const groups = new Map();
    for (const i of loud) {
      const key = i.kind === 'source' ? `source:${i.id}` : `${i.kind}:${i.word}`;
      if (!groups.has(key)) groups.set(key, { issue: i, n: 0 });
      groups.get(key).n += 1;
    }
    const parts = [...groups.values()].map(({ issue, n }) => phrase(issue, n));
    if (unknown) parts.push(`${unknown} no signal`);
    return parts.join(' · ');
  }
  if (unknown) return `${services.ok} up · ${unknown} no signal`;
  const parts = [];
  if (services.ok)
    parts.push(services.ok === 1 ? '1 service up' : `All ${services.ok} services up`);
  if (nodes.ok) parts.push(`${nodes.ok} ${noun('node', nodes.ok)} healthy`);
  return parts.length ? parts.join(' · ') : 'All clear';
}

/**
 * Everything the model says about the whole board: the overall state (the
 * worst of every entity and failed source; with neither, EMPTY when the model
 * says the board is `empty`, else unknown, since a read that didn't answer or
 * a source that is set up leaves nothing to judge, not nothing set up), its
 * sentence, the ranked issues and the subsystems.
 *
 * @param {any[]} entities
 * @param {any[]} sourceIssues
 * @param {{ empty?: boolean }} [board]
 */
export function summarize(entities, sourceIssues, { empty = false } = {}) {
  const subsystems = subsystemsOf(entities);
  const issues = rankIssues([...sourceIssues, ...entities.filter((e) => isIssue(e.state))]);
  const everything = [...entities, ...sourceIssues];
  const state =
    everything.length > 0 ? worstOf(everything.map((e) => e.state)) : empty ? EMPTY : 'unknown';
  return {
    overall: { state, sentence: sentenceOf(issues, entities, subsystems) },
    issues,
    subsystems,
  };
}
