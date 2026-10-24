/**
 * How Settings → Nodes & Services edits services.yaml's `services:` and the
 * nodes' `hide:` lists (#319; moved out of ServicesTab, #633, #636, #240).
 * Every function takes the config as read and gives back the whole config
 * with the one change, never touching the argument; the section hands it to
 * its save.
 *
 * A container that runs on more than one node gets its monitor, display name
 * and icon per node (`monitor_per_node.<nodeKey>` and the like), so editing
 * one node leaves the others alone. A container on one node keeps the
 * container-wide keys. A container that already has per-node entries stays
 * per-node even while a node is offline or hidden (and so missing from the
 * live data).
 */

/** The choice for `monitor: false` (no monitor, and no name matching). */
export const NO_MONITOR = '__none__';
/** The choice for no mapping: the matcher decides (Auto-match). */
export const AUTO_MATCH = '';

const PER_NODE_KEYS = ['monitor_per_node', 'display_name_per_node', 'icon_per_node'];

/** The name a container gets when nothing overrides it (the server's rule). */
export const defaultName = (container) =>
  container.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const entryOf = (config, container) => config?.services?.[container] || {};

/** The nodes, by key, of the live /api/services data. */
const liveNodesOf = (live) => live?.nodes || {};

/** `config` with `container`'s entry replaced by `entry` (dropped when empty). */
function withEntry(config, container, entry) {
  const services = { ...config.services };
  if (Object.keys(entry).length === 0) delete services[container];
  else services[container] = entry;
  return { ...config, services };
}

/**
 * Whether `container`'s edits go per node: it runs on more than one node, it
 * was written per node in this visit (`sticky`), or it already has entries.
 */
export function isPerNode(config, live, sticky, container) {
  const running = Object.values(liveNodesOf(live)).filter((n) =>
    (n.services || []).some((s) => s.container === container)
  ).length;
  if (running > 1 || sticky?.has(container)) return true;
  const entry = entryOf(config, container);
  return PER_NODE_KEYS.some((k) => entry[k] && Object.keys(entry[k]).length > 0);
}

/** The display name or icon (`field`) this node shows: its entry, else the container-wide one. */
export function effectiveText(config, container, nodeKey, field) {
  const entry = entryOf(config, container);
  const own = entry[`${field}_per_node`]?.[nodeKey];
  if (typeof own === 'string' && own.trim() !== '') return own;
  return typeof entry[field] === 'string' ? entry[field] : '';
}

/**
 * The monitor choice this node has, as the server resolves it: its entry, else
 * the container-wide one. `false` is NO_MONITOR, never Auto-match. A
 * container on one node (`perNode` false) reads the container-wide key alone.
 */
export function monitorChoice(config, container, nodeKey, perNode) {
  const entry = entryOf(config, container);
  const own = perNode ? entry.monitor_per_node?.[nodeKey] : undefined;
  if (own === false) return NO_MONITOR;
  if (typeof own === 'string' && own !== '') return own;
  if (entry.monitor === false) return NO_MONITOR;
  return typeof entry.monitor === 'string' ? entry.monitor : AUTO_MATCH;
}

// Every node key the config or the live data has, but `nodeKey`.
const otherNodeKeys = (config, live, nodeKey) => {
  const keys = new Set([...Object.keys(config.nodes || {}), ...Object.keys(liveNodesOf(live))]);
  keys.delete(nodeKey);
  return keys;
};

/**
 * Set a monitor name, NO_MONITOR (false) or AUTO_MATCH for this node.
 *
 * The first per-node write migrates a container-wide `monitor`: it is copied
 * to every other node the container is on (config nodes and live nodes) and
 * then deleted, so no hidden fallback is left behind and Auto-match on this
 * node really clears it. Other nodes' entries are untouched; empty maps and
 * empty overrides are dropped.
 */
export function withNodeMonitor(config, live, container, nodeKey, choice) {
  const existing = { ...entryOf(config, container) };
  const perNode = { ...(existing.monitor_per_node || {}) };
  if (typeof existing.monitor === 'string' || existing.monitor === false) {
    for (const k of otherNodeKeys(config, live, nodeKey)) {
      if (!Object.hasOwn(perNode, k)) perNode[k] = existing.monitor;
    }
  }
  delete existing.monitor;
  if (choice === AUTO_MATCH) delete perNode[nodeKey];
  else perNode[nodeKey] = choice === NO_MONITOR ? false : choice;
  if (Object.keys(perNode).length === 0) delete existing.monitor_per_node;
  else existing.monitor_per_node = perNode;
  return withEntry(config, container, existing);
}

/**
 * Set a monitor choice on a container that runs on one node: the
 * container-wide `monitor`. AUTO_MATCH removes it; NO_MONITOR writes `false`.
 */
export function withMonitor(config, container, choice) {
  const existing = { ...entryOf(config, container) };
  if (choice === AUTO_MATCH) delete existing.monitor;
  else existing.monitor = choice === NO_MONITOR ? false : choice;
  return withEntry(config, container, existing);
}

/**
 * Set or clear ('') this node's `display_name` or `icon` (`field`) in
 * `<field>_per_node`. The first per-node write copies a container-wide value
 * to the container's other nodes and deletes it, as withNodeMonitor does.
 */
export function withNodeText(config, live, container, nodeKey, field, value) {
  const mapKey = `${field}_per_node`;
  const existing = { ...entryOf(config, container) };
  const perNode = { ...(existing[mapKey] || {}) };
  if (typeof existing[field] === 'string' && existing[field].trim() !== '') {
    for (const k of otherNodeKeys(config, live, nodeKey)) {
      const cur = perNode[k];
      if (typeof cur !== 'string' || cur.trim() === '') perNode[k] = existing[field];
    }
  }
  delete existing[field];
  if (value === '') delete perNode[nodeKey];
  else perNode[nodeKey] = value;
  if (Object.keys(perNode).length === 0) delete existing[mapKey];
  else existing[mapKey] = perNode;
  return withEntry(config, container, existing);
}

/** Set a container-wide `field` (`display_name`, `icon`); '' clears it. */
export function withText(config, container, field, value) {
  const entry = { ...entryOf(config, container) };
  if (value === '') delete entry[field];
  else entry[field] = value;
  return withEntry(config, container, entry);
}

/** `container`'s overrides, all of them, removed. */
export function withoutOverrides(config, container) {
  return withEntry(config, container, {});
}

// Hide rules match a container by its EXACT name (case-insensitive), not a
// substring: hiding "redis" must not also hide "redis-backup", and un-hiding
// it must not strip every rule whose name is a substring of this one.
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

/** Whether the node's `hide:` list names the container. */
export function isHidden(config, nodeKey, container) {
  return (config.nodes?.[nodeKey]?.hide || []).some((h) => sameName(container, h));
}

/** The config with the container hidden on the node, or shown again. */
export function withHidden(config, nodeKey, container) {
  const node = config.nodes?.[nodeKey];
  if (!node) return config;
  const hide = node.hide || [];
  const next = isHidden(config, nodeKey, container)
    ? hide.filter((h) => !sameName(container, h))
    : [...hide, container];
  return { ...config, nodes: { ...config.nodes, [nodeKey]: { ...node, hide: next } } };
}
