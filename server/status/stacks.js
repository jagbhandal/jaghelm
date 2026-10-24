/**
 * Compose stacks in the status model (#642): the services refresh groups the
 * cards (server/stacks.js) and this reads that grouping onto the entities, so
 * the model counts a stack as ONE row while every member stays an entity of
 * its own, judged as before.
 *
 *  - the stack's lead entity gets `stack: { id, project, name, count, chip, bad,
 *    members, rollup }` (`chip`: the row's "+3 · 1 down"): `members` are `{ id, name, state, word, reason, lead? }`, the
 *    rollup is the row's `{ state, word, reason, since, member }`, the worst of
 *    its members (stacks.js rollupOf);
 *  - a folded member gets `foldedInto: <lead entity id>`.
 *
 * An entity's own state, word and reason are never changed, so push, which
 * reads the entities, sends what it always did, on the same ids. What counts
 * rows (the subsystems, the issue list, the sentence) reads `rowsOf` instead:
 * the entities without the folded ones, the lead with its rollup's state.
 */
import { rollupOf } from '../stacks.js';

const PREFIX = 'services/';

/**
 * The entities with the stacks' annotations (shallow copies; the given ones
 * are untouched), and the rows they make.
 * @param {any[]} entities
 * @param {Record<string, { services?: any[] }>} nodes  the services payload's
 * @returns {{ entities: any[], rows: any[], any: boolean }}
 */
export function withStacks(entities, nodes) {
  const byId = new Map(entities.map((e) => [e.id, e]));
  /** @type {Map<string, any>} */
  const leads = new Map();
  /** @type {Map<string, string>} */
  const folded = new Map();
  for (const node of Object.values(nodes ?? {})) {
    for (const card of node?.services ?? []) {
      if (typeof card?.uid !== 'string') continue;
      if (card.stack && byId.has(PREFIX + card.uid)) leads.set(PREFIX + card.uid, card.stack);
      if (
        typeof card.foldedInto === 'string' &&
        byId.has(PREFIX + card.foldedInto) &&
        byId.has(PREFIX + card.uid)
      ) {
        folded.set(PREFIX + card.uid, PREFIX + card.foldedInto);
      }
    }
  }
  // A lead whose members the model does not all have is a stack of those it has.
  const stackOf = new Map();
  for (const [leadId, stack] of leads) {
    const members = (stack.members ?? [])
      .map((m) => ({ ...m, entity: byId.get(PREFIX + m.uid) }))
      .filter(
        (m) => m.entity && (PREFIX + m.uid === leadId || folded.get(PREFIX + m.uid) === leadId)
      );
    if (members.length < 2) continue;
    const lead = byId.get(leadId);
    const verdicts = members.map((m) => ({
      id: m.entity.id,
      name: m.entity.name,
      state: m.entity.state,
      word: m.entity.word,
      reason: m.entity.reason,
    }));
    const rolled = rollupOf(verdicts, leadId);
    const behind = rolled.id ? byId.get(rolled.id) : lead;
    // The chip after the row's name: "+3", or "+3 · 1 down" (its worst kind of failing member).
    const n = (state) => verdicts.filter((v) => v.state === state).length;
    const first = [
      [n('crit'), 'down'],
      [n('warn'), 'stopped'],
      [n('unknown'), 'no signal'],
    ].find(([k]) => k > 0);
    stackOf.set(leadId, {
      id: stack.id,
      project: stack.project,
      name: stack.name,
      count: members.length,
      chip: `+${members.length - 1}${first ? ` · ${first[0]} ${first[1]}` : ''}`,
      bad: Boolean(first),
      members: verdicts
        .map((v) => (v.id === leadId ? { ...v, lead: true } : v))
        .sort(
          (a, b) =>
            (a.lead ? -1 : b.lead ? 1 : 0) ||
            (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
            (a.id < b.id ? -1 : 1)
        ),
      rollup: {
        state: rolled.state,
        word: rolled.word,
        reason: rolled.reason,
        since: behind.since,
        member: rolled.id,
      },
    });
  }
  // Folded members of a lead that is no stack stay rows of their own.
  const hidden = new Map([...folded].filter(([, leadId]) => stackOf.has(leadId)));
  const out = entities.map((e) => {
    if (stackOf.has(e.id)) return { ...e, stack: stackOf.get(e.id) };
    if (hidden.has(e.id)) return { ...e, foldedInto: hidden.get(e.id) };
    return e;
  });
  const rows = out
    .filter((e) => !e.foldedInto)
    .map((e) => {
      if (!e.stack) return e;
      const { state, word, reason, since } = e.stack.rollup;
      return { ...e, state, word, reason, since };
    });
  return { entities: out, rows, any: stackOf.size > 0 };
}
