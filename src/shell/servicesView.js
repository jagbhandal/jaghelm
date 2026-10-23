/**
 * The Overview's Services section (#300, spec §8 item 4): each service the
 * status model has, as its row draws it, in its groups. The client judges
 * nothing (spec §6):
 *
 *  - a row's state, word and reason are its entity's in /api/status (the
 *    Services subsystem's: a Kuma monitor, or a container with none);
 *  - /api/services and the integrations only add numbers: the latency (Kuma's
 *    last response time) and one headline integration metric ("24,499
 *    photos"), and only on a row the model says is up. A row that isn't says
 *    the model's reason instead, and no latency: an old number is never drawn
 *    beside a failure.
 *
 * With a stale status (`freshness`, statusFreshness.js, #480, #495), nothing
 * is drawn in a level colour from it: every row is drawn as no signal, keeping
 * its words and numbers as last known, and the section's count says how old
 * they are. The rows keep the model's order, so they don't move when the
 * signal drops.
 *
 * Grouped by node (services.yaml's order, as /api/services lists the nodes)
 * or by the custom groups of Settings → Sections (display-config's
 * `customGroups`), with the services in none of them last. services.yaml has
 * no tags, so there is no grouping by tag. Within a group, the worst first,
 * then by name. The choice is kept per browser (useServicesGrouping).
 *
 * The Services page (#313) lists the same rows, narrowed by its filters
 * (`filterServiceRows`, listFilters.js: the search, the state drawn, the node,
 * a tag once services have tags, #519), as the same groups or as a table
 * (useServicesView).
 */
import { heldUids } from './customGroups.js';
import { entityAnchor } from './entityAnchors.js';
import { searchMatches, stateMatches } from './listFilters.js';
import { drawnState } from './statusFreshness.js';
import { usePref } from './usePref.js';

// The model's levels, worst first, as a row is ranked in its group.
const RANK = { crit: 0, warn: 1, unknown: 2, maintenance: 3, ok: 4 };
const rank = (level) => RANK[level] ?? RANK.unknown;

const SERVICE_KINDS = new Set(['service', 'container']);
const PREFIX = 'services/';

// A value that reads as a count or an amount ("24,499", "18.2", "41k"): it
// goes before its label, as the mock's "24,499 assets".
const AMOUNT = /^\d[\d,]*(?:\.\d+)?\s?[kKMG]?$/;

/**
 * An integration's headline metric, from its fields as the board gets them
 * (useAppDataMatching: `{ Photos: "24,499", Usage: "1.2 TB", _doctor }`): its
 * first field, an amount before its label ("24,499 photos"), anything else
 * after it ("Version 10.9.1"). None without a field.
 */
export function headlineMetric(appData) {
  if (!appData || typeof appData !== 'object') return null;
  const entry = Object.entries(appData).find(
    ([label, value]) => !label.startsWith('_') && value != null && String(value).trim() !== ''
  );
  if (!entry) return null;
  const [label, raw] = entry;
  const value = String(raw).trim();
  return AMOUNT.test(value) ? `${value} ${label.toLowerCase()}` : `${label} ${value}`;
}

/** Kuma's last response time, "138 ms", or null without one. */
function latencyOf(card) {
  const ms = Number(card?.ping);
  return card?.ping != null && Number.isFinite(ms) && ms > 0 ? `${Math.round(ms)} ms` : null;
}

/** /api/services' cards, by uid, each with its node. */
function cardsOf(services) {
  const out = new Map();
  for (const node of Object.values(services?.nodes ?? {})) {
    for (const card of node?.services ?? []) {
      if (card && typeof card.uid === 'string') out.set(card.uid, card);
    }
  }
  return out;
}

/** The entity's tags (#519: Kuma's monitor tags, once the model serves them), or none. */
const tagsOf = (entity) =>
  Array.isArray(entity.tags)
    ? [
        ...new Set(
          entity.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
        ),
      ]
    : [];

/**
 * Each service the model has, as its row: `{ id, anchor, uid, container,
 * containerName, name, node, nodeName, level, state, word, detail, meta,
 * muted, tags }`.
 * `level` is the model's state, `state` the one drawn (no signal while
 * stale); `detail` the headline metric when up, else the model's reason;
 * `meta` the latency when up, else a dash; `tags` the entity's (none until
 * #519). A service on a node hidden in Settings
 * (`sections[key].visible === false`) is left out, as the node is.
 *
 * `appData` is each service's integration fields, by uid (useAppDataMatching).
 *
 * @param {{ status: any, services?: any, appData?: Record<string, any>,
 *   sections?: Record<string, any>, freshness?: { stale: boolean } }} board
 */
export function serviceRows({
  status,
  services = null,
  appData = null,
  sections = {},
  freshness = null,
}) {
  const cards = cardsOf(services);
  return (status?.entities ?? [])
    .filter((e) => e.subsystem === 'services' && SERVICE_KINDS.has(e.kind))
    .filter((e) => sections?.[e.node]?.visible !== false)
    .map((e) => {
      const uid = e.id.startsWith(PREFIX) ? e.id.slice(PREFIX.length) : e.id;
      const card = cards.get(uid) ?? null;
      const container = card?.container ?? uid.slice(uid.indexOf(':') + 1);
      const up = e.state === 'ok';
      return {
        id: e.id,
        anchor: entityAnchor(e.id),
        uid,
        container,
        // The same, as the Services table reads it: src/ui can't name a field
        // `container`, which Tailwind's scan would ship as a utility (#424).
        containerName: container,
        name: e.name,
        node: e.node ?? null,
        nodeName: services?.nodes?.[e.node]?.display_name || e.node || null,
        level: e.state,
        state: drawnState(e.state, freshness),
        word: e.word,
        detail: up ? headlineMetric(appData?.[uid]) : e.reason || null,
        meta: (up && latencyOf(card)) || '—',
        muted: up,
        tags: tagsOf(e),
      };
    });
}

/** The ways the section can group, as its control names them. */
export const GROUPINGS = Object.freeze([
  Object.freeze({ value: 'node', label: 'Node' }),
  Object.freeze({ value: 'group', label: 'Group' }),
]);

/**
 * The control's options: by node, and by group, which is disabled until
 * Settings has a custom group (the section then says where to add one).
 */
export function groupingsFor(customGroups) {
  const any = Array.isArray(customGroups) && customGroups.length > 0;
  return GROUPINGS.map((g) => ({ ...g, disabled: g.value === 'group' && !any }));
}

const byRank = (a, b) =>
  rank(a.level) - rank(b.level) || String(a.name).localeCompare(String(b.name));

/** "7 / 8 up": the group's rows the model says are up, of all. */
function upCount(rows) {
  return `${rows.filter((r) => r.level === 'ok').length} / ${rows.length} up`;
}

const group = (key, title, host, rows, where = false) => {
  const sorted = [...rows].sort(byRank).map((r) => ({ ...r, where: where ? r.nodeName : null }));
  return { key, title, host, count: upCount(sorted), rows: sorted };
};

/**
 * The rows in their groups, `[{ key, title, host, count, rows }]`, each row
 * with `where` (its node, when the group isn't one):
 *
 *   node   a group per node, in services.yaml's order (as /api/services lists
 *          them), then any it has yet to list; titled by the node's name,
 *          its key beside it when that differs
 *   group  a group per custom group, in Settings' order, holding the services
 *          it names (customGroups.js: by uid, so a container on two nodes is
 *          two services; a bare container name saved before #517 holds every
 *          service of that name; a service in two is in the first), then "Not
 *          in a group"; a custom group with none of the services is left out
 *
 * @param {Array<any>} rows  serviceRows'
 * @param {{ by?: string, services?: any, customGroups?: Array<any> }} opts
 */
export function serviceGroups(rows, { by = 'node', services = null, customGroups = [] } = {}) {
  if (by === 'group' && Array.isArray(customGroups) && customGroups.length > 0) {
    const placed = new Set();
    const out = [];
    for (const g of customGroups) {
      const held = new Set(heldUids(g, rows));
      const members = rows.filter((r) => !placed.has(r.id) && held.has(r.uid));
      for (const r of members) placed.add(r.id);
      if (members.length > 0)
        out.push(group(`group:${g.id}`, g.title || 'Group', null, members, true));
    }
    const rest = rows.filter((r) => !placed.has(r.id));
    if (rest.length > 0) out.push(group('group:none', 'Not in a group', null, rest, true));
    return out;
  }
  const listed = Object.keys(services?.nodes ?? {});
  const keys = [...listed];
  for (const r of rows) if (!keys.includes(r.node)) keys.push(r.node);
  return keys
    .map((key) => {
      const members = rows.filter((r) => r.node === key);
      if (members.length === 0) return null;
      const title = members[0].nodeName || key || 'Services';
      return group(`node:${key}`, title, key && key !== title ? key : null, members);
    })
    .filter(Boolean);
}

// How a count of rows in a level reads after the number.
function phrase(level, word, n) {
  if (level === 'maintenance') return `${n} in maintenance`;
  return `${n} ${String(word || '').toLowerCase() || 'not up'}`;
}

/**
 * The section's count, the mock's: "12 monitored · all up", "12 monitored · 1
 * down · 1 no signal", each failing kind by its word, worst first; with a
 * stale status, how old it is instead: "12 monitored · No signal · last known
 * 3 min ago". With `of`, the rows are what a filter left of that many: "3 of
 * 12 monitored · 1 down", and "0 of 12 monitored" when it left none.
 */
export function servicesCount(rows, freshness = null, { of = null } = {}) {
  const first = of == null ? `${rows.length} monitored` : `${rows.length} of ${of} monitored`;
  if (freshness?.stale) return [first, freshness.note].filter(Boolean).join(' · ');
  const counts = new Map();
  for (const r of [...rows].sort(byRank)) {
    if (r.level === 'ok') continue;
    const key = `${r.level}\n${r.word}`;
    counts.set(key, { level: r.level, word: r.word, n: (counts.get(key)?.n ?? 0) + 1 });
  }
  const parts = [...counts.values()].map(({ level, word, n }) => phrase(level, word, n));
  // A filter that left nothing says nothing is up or down.
  if (rows.length === 0 && of != null) return first;
  return [first, ...(parts.length ? parts : ['all up'])].join(' · ');
}

/** Where the section's grouping is kept, per browser (`prefs`). */
export const GROUPING_PREF = 'jaghelm-services-grouping';
const VALUES = Object.freeze(GROUPINGS.map((g) => g.value));

/**
 * The section's grouping, `node` or `group`, and what changes it: kept per
 * browser, one choice for the Overview and the Services page (usePref).
 */
export function useServicesGrouping() {
  return usePref(GROUPING_PREF, VALUES, 'node');
}

/** Where the Services page's list / table choice is kept, per browser. */
export const SERVICES_VIEW_PREF = 'jaghelm-services-view';
const SERVICE_VIEWS = Object.freeze(['list', 'table']);

/** The Services page's view, `list` or `table`, and what changes it: kept per browser. */
export function useServicesView() {
  return usePref(SERVICES_VIEW_PREF, SERVICE_VIEWS, 'list');
}

/**
 * The custom groups' titles by service uid (customGroups.js: by uid, or a bare
 * container name saved before #517), so a search finds a service by its group.
 */
function groupTitles(rows, customGroups) {
  const out = new Map();
  for (const g of Array.isArray(customGroups) ? customGroups : []) {
    const title = g?.title || null;
    if (!title) continue;
    for (const uid of heldUids(g, rows)) out.set(uid, [...(out.get(uid) ?? []), title]);
  }
  return out;
}

/**
 * The rows the Services page's filters keep (listFilters.js), in their order:
 *
 *   q      each word in the service's name, its node's key or name, a custom
 *          group holding it, its container or uid, or a tag
 *   state  the state it is drawn in (with a stale status, every row is no
 *          signal: listed under "No signal" and "Problems", as drawn)
 *   node   its node's key
 *   tag    one of its tags
 *
 * @param {Array<any>} rows  serviceRows'
 * @param {{ q?: string, state?: string | null, node?: string | null, tag?: string | null }} filters
 * @param {{ customGroups?: Array<any> }} [opts]
 */
export function filterServiceRows(rows, filters = {}, { customGroups = [] } = {}) {
  const { q = '', state = null, node = null, tag = null } = filters;
  const groups = q ? groupTitles(rows, customGroups) : null;
  return rows.filter(
    (r) =>
      stateMatches(state, r.state) &&
      (!node || r.node === node) &&
      (!tag || (r.tags ?? []).includes(tag)) &&
      searchMatches(q, [
        r.name,
        r.node,
        r.nodeName,
        r.container,
        r.uid,
        ...(groups?.get(r.uid) ?? []),
        ...(r.tags ?? []),
      ])
  );
}

/**
 * What the page's Node and Tag filters offer, from every row (not only those
 * a filter left): the nodes `[{ value, label }]` in services.yaml's order (as
 * /api/services lists them), then any the model has that it doesn't; the
 * tags, sorted, none until services have tags (#519), so no Tag filter shows.
 *
 * @param {Array<any>} rows  serviceRows'
 * @param {any} [services]  /api/services
 */
export function serviceFilterOptions(rows, services = null) {
  const listed = Object.keys(services?.nodes ?? {});
  const keys = [...listed.filter((k) => rows.some((r) => r.node === k))];
  for (const r of rows) if (r.node && !keys.includes(r.node)) keys.push(r.node);
  const nodes = keys.map((key) => ({
    value: key,
    label: rows.find((r) => r.node === key)?.nodeName || key,
  }));
  const tags = [...new Set(rows.flatMap((r) => r.tags ?? []))].sort((a, b) => a.localeCompare(b));
  return { nodes, tags };
}
