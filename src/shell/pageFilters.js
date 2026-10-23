/**
 * What the Services and Infrastructure pages' filters keep (#313,
 * listFilters.js), from the rows and nodes the Overview's sections draw
 * (servicesView.js, infrastructureView.js). Apart from those, so only the
 * pages' chunks carry it, never the first load.
 */
import { heldUids } from './customGroups.js';
import { searchMatches, stateMatches } from './filterQuery.js';

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

/**
 * The nodes the Infrastructure page's filters keep (listFilters.js), in their
 * order:
 *
 *   q      each word in the node's name, its key or its role
 *   state  the state it is drawn in (with a stale status, every node is no
 *          signal)
 *   role   its role, services.yaml's subtitle ("Proxmox VM")
 *
 * @param {Array<any>} nodes  infrastructureNodes'
 * @param {{ q?: string, state?: string | null, role?: string | null }} filters
 */
export function filterNodes(nodes, filters = {}) {
  const { q = '', state = null, role = null } = filters;
  return nodes.filter(
    (n) =>
      stateMatches(state, n.state) &&
      (!role || n.subtitle === role) &&
      searchMatches(q, [n.name, n.host, n.subtitle])
  );
}

/** The roles the page's Role filter offers, `[{ value, label }]`, in the nodes' order, each once. */
export function roleOptions(nodes) {
  return [...new Set(nodes.map((n) => n.subtitle).filter(Boolean))].map((r) => ({
    value: r,
    label: r,
  }));
}
