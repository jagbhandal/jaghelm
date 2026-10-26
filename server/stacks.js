/**
 * One row per Compose stack (#642): which of a node's cards fold into which,
 * decided once, here. The client never groups.
 *
 * A stack is one Compose project on one node (cAdvisor's
 * `container_label_com_docker_compose_project`, discovery.js): the same
 * container name on two nodes (gateway-npm on both Pis) is two cards and no
 * stack, and a container with no project label (a Pi's cAdvisor) is its own
 * row. The cards keep their uids and their own status, so push, alerts,
 * per-node overrides, custom groups and monitor mapping keep keying by the
 * container as before. Grouping only ANNOTATES the cards:
 *
 *  - the stack's lead card gets `stack: { id, project, name, members, rollup }`;
 *  - each folded member gets `foldedInto: <lead uid>`.
 *
 * Which members are rows of their own, and which fold into the lead:
 *
 *  1. A member with its OWN Kuma monitor that checks a web address is its own
 *     row (Nextcloud and Collabora are two rows). A monitor of a port, ping or
 *     DNS check is not a web address; a monitor whose kind is unknown (the
 *     status-page fallback) counts as one.
 *  2. Every other member (no monitor of its own: redis, postgres, cron, ML)
 *     folds into the stack's lead.
 *  3. The lead is chosen from ALL the members, running or not: from those that
 *     are their own rows when there are any (the stack's monitored members),
 *     else from the rest, by the lowest `leadRank`: the member named for the
 *     project first (immich-server for immich, loki for loki), then a
 *     main-process name (server, app, web...), then any other, a database or
 *     cache after them and an exporter or cAdvisor last; then the shorter
 *     name, then the name itself. A member that stops (its grey or red card)
 *     keeps the row and its own state, and the lead never moves when a member
 *     stops or starts. It depends on the names alone, never on the order
 *     cards arrive in.
 *  4. A stack with nothing folded into its lead is no stack: no annotation.
 *
 * services.yaml's `stacks:` overrides it per node and project, as
 * `stacks: { "<node>:<project>": { lead, ungroup, split, display_name } }`:
 * `lead` names the container that leads, `ungroup: true` leaves the stack
 * as plain rows, `split` lists containers that stay rows of their own.
 *
 * The stack is named by `display_name` in its override, else by its lead when
 * the lead is the container named for the project (`wikijs`, which services.yaml
 * may have renamed "Wiki.js"), else by the project in words ("Immich").
 *
 * The rollup is the worst member: crit > warn > unknown > ok (a member in
 * maintenance is none of them). A failing member other than the lead makes
 * the row "Degraded", the reason naming it ("Immich Redis is down"); a
 * failing lead keeps its own word. The status model rolls up by its entities'
 * states with the same function (rollupOf).
 */
import { createLogger } from './util/logger.js';
import { stateRank } from './status/rules.js';

const log = createLogger('stacks');

/** The kinds of Kuma check that look at a web address. */
const WEB_TYPES = new Set(['http', 'keyword', 'json-query', 'real-browser', 'grpc-keyword']);

/** Whether a Kuma monitor checks a web address (its kind, or unknown). */
export function isWebMonitor(monitor) {
  const type = monitor?.type;
  return typeof type !== 'string' || WEB_TYPES.has(type);
}

const squash = (/** @type {string} */ s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const HELPER = /exporter|cadvisor|promtail|alloy/;
const MAIN = new Set(['server', 'app', 'web', 'main', 'core', 'api', 'ui', 'frontend']);
const SIDE = new Set([
  'redis',
  'valkey',
  'postgres',
  'postgresql',
  'pgsql',
  'db',
  'database',
  'mariadb',
  'mysql',
  'mongo',
  'cache',
  'cron',
  'worker',
  'ml',
  'machinelearning',
  'proxy',
  'exporter',
  'sidecar',
  'init',
  'migrate',
]);

/**
 * How well a container's name says "the main part of this project", lower is
 * better: 0 the project's own name, 1 a main-process name after it, 2 other
 * names that carry the project, 3 others, 4 a database, cache or helper.
 * @param {string} container
 * @param {string} project
 */
export function leadRank(container, project) {
  const name = squash(container);
  const base = squash(project);
  if (!name) return 4;
  // An exporter or cAdvisor is a helper of the host, never the stack's lead while anything else can be.
  if (HELPER.test(name)) return 5;
  if (name === base) return 0;
  const rest =
    base && name.startsWith(base)
      ? name.slice(base.length)
      : name.endsWith(base)
        ? name.slice(0, -base.length)
        : null;
  // "immich_server-1": the replica number is no part of the name.
  const word = (rest ?? name).replace(/\d+$/, '');
  if (rest !== null && MAIN.has(word)) return 1;
  if (SIDE.has(word)) return 4;
  return rest !== null ? 2 : 3;
}

/** The members in lead order, best first. */
function byLead(project) {
  return (/** @type {any} */ a, /** @type {any} */ b) =>
    leadRank(a.container, project) - leadRank(b.container, project) ||
    a.container.length - b.container.length ||
    (a.container < b.container ? -1 : a.container > b.container ? 1 : 0);
}

/**
 * The worst of a stack's members, as the row says it: `{ state, word, reason,
 * id }`, `id` the member behind it (null when the row is the lead's own).
 * Each member is `{ id, name, state, word?, reason? }`; `lead` is the lead's
 * id. Pure and independent of the order of `members`.
 * @param {Array<{ id: string, name: string, state: string, word?: string, reason?: string }>} members
 * @param {string} lead
 */
export function rollupOf(members, lead) {
  const own = members.find((m) => m.id === lead);
  const ownVerdict = {
    state: own?.state ?? 'ok',
    word: own?.word ?? '',
    reason: own?.reason ?? '',
    id: null,
  };
  const bad = members
    .filter((m) => m.id !== lead && stateRank(m.state) >= stateRank('unknown'))
    .sort(
      (a, b) => stateRank(b.state) - stateRank(a.state) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  const worst = bad[0];
  // The lead is at least as bad as any other member: the row is its own.
  if (!worst || stateRank(ownVerdict.state) >= stateRank(worst.state)) return ownVerdict;
  const word = worst.state === 'unknown' ? 'No signal' : 'Degraded';
  return { state: worst.state, word, reason: memberPhrase(worst), id: worst.id };
}

/** What a failing member says in the row's reason: "Immich Redis is down". */
function memberPhrase(/** @type {{ name: string, state: string, word?: string }} */ m) {
  if (m.state === 'crit') return `${m.name} is down`;
  if (m.state === 'unknown') return `${m.name} has no signal`;
  if (m.word === 'Missing') return `${m.name} has stopped`;
  return `${m.name}: ${String(m.word || 'warning').toLowerCase()}`;
}

/** A card's status as the model's vocabulary names it (the card-level rollup). */
function cardState(/** @type {any} */ card) {
  if (card.status === 'down') return { state: 'crit', word: 'Down' };
  if (card.status === 'up') return { state: 'ok', word: 'Up' };
  if (card.source === 'presence') return { state: 'warn', word: 'Missing' };
  return { state: 'unknown', word: 'No signal' };
}

// Warnings already logged: one per problem per boot.
const warned = new Set();
function warnOnce(
  /** @type {string} */ key,
  /** @type {object} */ fields,
  /** @type {string} */ msg
) {
  if (warned.has(key)) return;
  warned.add(key);
  log.warn(fields, msg);
}

const isMap = (/** @type {unknown} */ v) => !!v && typeof v === 'object' && !Array.isArray(v);
const lower = (/** @type {unknown} */ v) =>
  String(v ?? '')
    .trim()
    .toLowerCase();

/**
 * One `stacks:` entry as the grouping reads it; anything of another type is
 * left out (a hand edit never fails the refresh).
 * @param {unknown} raw
 */
function overrideOf(raw) {
  if (!isMap(raw)) return { lead: null, ungroup: false, split: new Set(), name: null };
  const entry = /** @type {Record<string, unknown>} */ (raw);
  return {
    lead: typeof entry.lead === 'string' && entry.lead.trim() ? lower(entry.lead) : null,
    ungroup: entry.ungroup === true,
    split: new Set(
      (Array.isArray(entry.split) ? entry.split : [])
        .filter((c) => typeof c === 'string')
        .map(lower)
    ),
    name:
      typeof entry.display_name === 'string' && entry.display_name.trim()
        ? entry.display_name.trim()
        : null,
  };
}

/** The `stacks:` keys that are `node:project`, with their parts; others warn once. */
function overridesOf(/** @type {unknown} */ stacks) {
  /** @type {Map<string, ReturnType<typeof overrideOf> & { node: string, project: string }>} */
  const out = new Map();
  if (stacks == null) return out;
  if (!isMap(stacks)) {
    warnOnce(
      'shape',
      {},
      'services.yaml: stacks must map "node:project" to settings, so it is ignored (logged once)'
    );
    return out;
  }
  for (const [key, raw] of Object.entries(/** @type {Record<string, unknown>} */ (stacks))) {
    const at = key.indexOf(':');
    if (at <= 0 || at === key.length - 1) {
      warnOnce(
        `key\u0000${key}`,
        { key },
        'services.yaml: a stacks key must be "node:project", so it is ignored (logged once)'
      );
      continue;
    }
    out.set(`${key.slice(0, at)}:${lower(key.slice(at + 1))}`, {
      ...overrideOf(raw),
      node: key.slice(0, at),
      project: lower(key.slice(at + 1)),
    });
  }
  return out;
}

/**
 * Annotate `nodes`' cards with their stacks, in place (see the top of this
 * file). `nodes` is the services payload's, `{ nodeKey: { services: [card] } }`;
 * a card is `{ uid, container, display_name, status, source, project?, image?,
 * monitored }`. `web` is the set of uids whose monitor checks a web address;
 * `nameOf` words a project as a stack's name; `stacks` is services.yaml's.
 *
 * Returns the stacks it made, `{ id, node, project, lead, members }`, sorted by
 * id (a node's order, then the project's).
 *
 * @param {{ nodes: Record<string, { services?: any[] }>, stacks?: unknown, web?: Set<string>, nameOf?: (project: string) => string, configNodes?: string[] | null }} input
 */
export function groupStacks({
  nodes,
  stacks = null,
  web = new Set(),
  nameOf = (p) => p,
  configNodes = null,
}) {
  const overrides = overridesOf(stacks);
  const found = new Set();
  const made = [];

  for (const nodeKey of Object.keys(nodes).sort()) {
    const cards = (nodes[nodeKey]?.services ?? []).filter(
      (c) => c && typeof c.project === 'string' && c.project
    );
    const projects = [...new Set(cards.map((c) => c.project))].sort();
    for (const project of projects) {
      const key = `${nodeKey}:${project}`;
      found.add(key);
      const set = overrides.get(key) ?? overrideOf(null);
      if (set.ungroup) continue;
      const members = cards.filter((c) => c.project === project);
      // A stack needs a running member; its lead is chosen from ALL members,
      // running or not, so a lead that stops keeps its row and its own state,
      // and the lead never moves when a member stops or starts.
      if (!members.some((c) => c.source === 'container')) continue;

      const wanted = set.lead ? members.find((c) => lower(c.container) === set.lead) : null;
      if (set.lead && !wanted) {
        warnOnce(
          `lead\u0000${key}\u0000${set.lead}`,
          { stack: key, lead: set.lead },
          'services.yaml: a stacks lead names no container of that project, so the lead is chosen as if it had none (logged once)'
        );
      }
      const isSplit = (/** @type {any} */ c) => set.split.has(lower(c.container)) && c !== wanted;
      const own = (/** @type {any} */ c) => web.has(c.uid);
      // A member with its own web monitor leads before any other can.
      const rows = members.filter((c) => !isSplit(c) && own(c));
      const pool = rows.length > 0 ? rows : members.filter((c) => !isSplit(c));
      const lead = wanted ?? [...pool].sort(byLead(project))[0];
      if (!lead) continue;
      const folded = members.filter((c) => c !== lead && !isSplit(c) && !own(c));
      for (const name of set.split) {
        if (!members.some((c) => lower(c.container) === name)) {
          warnOnce(
            `split\u0000${key}\u0000${name}`,
            { stack: key, container: name },
            'services.yaml: a stacks split names no container of that project (logged once)'
          );
        }
      }
      if (folded.length === 0) continue;

      const all = [
        lead,
        ...folded.sort(
          (a, b) =>
            lower(a.display_name).localeCompare(lower(b.display_name)) || (a.uid < b.uid ? -1 : 1)
        ),
      ];
      const verdicts = all.map((c) => ({
        id: c.uid,
        name: c.display_name || c.container,
        ...cardState(c),
      }));
      const rollup = rollupOf(verdicts, lead.uid);
      const id = key;
      lead.stack = {
        id,
        project,
        name:
          set.name ??
          (leadRank(lead.container, project) === 0 ? lead.display_name : nameOf(project)),
        rollup: {
          state: rollup.state,
          word: rollup.word,
          reason: rollup.reason,
          member: rollup.id,
        },
        members: all.map((c) => {
          const m = {
            uid: c.uid,
            container: c.container,
            name: c.display_name || c.container,
            status: c.status,
            source: c.source,
          };
          if (c.image) m.image = c.image;
          if (c === lead) m.lead = true;
          return m;
        }),
      };
      for (const c of folded) c.foldedInto = lead.uid;
      made.push({ id, node: nodeKey, project, lead: lead.uid, members: all.map((c) => c.uid) });
    }
  }

  for (const [key, set] of overrides) {
    if (found.has(key)) continue;
    // With no node data at all (Prometheus down), nothing can be said of a project.
    const known = configNodes ? configNodes.includes(set.node) : Object.hasOwn(nodes, set.node);
    const seen = Object.values(nodes).some((n) => (n?.services ?? []).some((c) => c?.project));
    if (!known) {
      warnOnce(
        `node\u0000${key}`,
        { stack: key },
        'services.yaml: stacks names a node that is not under nodes:, so it is ignored (logged once)'
      );
    } else if (seen) {
      warnOnce(
        `project\u0000${key}`,
        { stack: key },
        'services.yaml: stacks names a Compose project that no container of that node carries, so it is ignored (logged once)'
      );
    }
  }
  return made.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
