/**
 * Node keys (#572). A node's key is how JagHelm names it everywhere: in the
 * board's uids ("node:container", split at the first colon), per-node
 * overrides, custom groups and backup job keys. A ':' in one corrupts all of
 * those, so a key never has one.
 *
 * A Prometheus `node` label is used as it is. With none, discovery falls
 * back to the `instance` label ("pi9:9100"), which carries a port: the key is
 * its host part, and the node's `prometheus_node` stays the real label so the
 * queries (`node=~…`) still match.
 */

/**
 * The key for Prometheus label `label`, not one of `taken` (a Set of keys in
 * use, which it does not change): the label without a trailing :port and
 * without any ':' or whitespace; `node` if nothing is left. A key already
 * taken gets -2, -3, … (deterministic, no random part).
 * @param {string} label
 * @param {Set<string>} [taken]
 */
export function nodeKeyFor(label, taken = new Set()) {
  const base = String(label).replace(/:\d+$/, '').replace(/[:\s]+/g, '') || 'node';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** The keys of `nodes` (a mapping, else none) that contain a ':'. */
export function colonNodeKeys(nodes) {
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) return [];
  return Object.keys(nodes).filter((k) => k.includes(':'));
}
