/**
 * The order of the nodes (#667). One saved list, `nodeOrder` in the display
 * config (Settings → Nodes & Services moves a node up or down), and one rule
 * for it, orderNodes, which every screen that lists nodes gets through
 * withNodeOrder: the services body (/api/services) is put in that order where
 * the dashboard reads it (useDashboardData), so the Infrastructure page, the
 * Services page's groups and Node filter, the Overview and the phone's screens
 * all list the nodes the same way.
 */

const MAX_NODES = 64;

/**
 * `keys` in the saved order: the listed keys first, as saved, then the rest
 * (a node new since the list was saved) in their current order. A listed key
 * that is not in `keys` (a removed node) is ignored, so it leaves no gap. A
 * `nodeOrder` that is no list of strings (a hand edit) is no order: `keys`
 * as they are.
 *
 * @param {string[]} keys
 * @param {unknown} nodeOrder
 * @returns {string[]}
 */
export function orderNodes(keys, nodeOrder) {
  if (!Array.isArray(nodeOrder) || !nodeOrder.every((k) => typeof k === 'string')) return [...keys];
  const have = new Set(keys);
  const first = [...new Set(nodeOrder)].filter((k) => have.has(k));
  const listed = new Set(first);
  return [...first, ...keys.filter((k) => !listed.has(k))];
}

/**
 * /api/services' body with its `nodes` in the saved order. The same body (the
 * one object, so a 304 stays a 304 for the screens) when there is nothing to
 * change.
 */
export function withNodeOrder(services, nodeOrder) {
  const nodes = services?.nodes;
  if (!nodes || typeof nodes !== 'object' || !Array.isArray(nodeOrder)) return services;
  const keys = Object.keys(nodes);
  const ordered = orderNodes(keys, nodeOrder);
  if (ordered.every((k, i) => k === keys[i])) return services;
  return { ...services, nodes: Object.fromEntries(ordered.map((k) => [k, nodes[k]])) };
}

/**
 * `keys` with `key` moved by `step` places (-1 up, 1 down), or null when it
 * can't move that way (first going up, last going down, not in the list).
 */
export function moveKey(keys, key, step) {
  const from = keys.indexOf(key);
  const to = from + step;
  if (from === -1 || to < 0 || to >= keys.length) return null;
  const out = [...keys];
  out.splice(from, 1);
  out.splice(to, 0, key);
  return out;
}

/** What `nodeOrder` may hold: the first 64 keys. */
export const savedOrder = (keys) => keys.slice(0, MAX_NODES);
