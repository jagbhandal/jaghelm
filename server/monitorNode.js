// @ts-check
/**
 * Which node a Kuma monitor that no container carries belongs on (#644).
 *
 * Such a monitor (cadvisor-pi1, whose cAdvisor is hidden from the board) has
 * no container to put it on a node, so it used to fall to the first node. Here
 * the node is chosen, in this order, from what is known about it:
 *
 *  1. `monitor_nodes` in services.yaml, keyed by the monitor's name: the node
 *     it names (a node that is on the board).
 *  2. The host the monitor checks (Kuma's `monitor_hostname`, else the host of
 *     `monitor_url`) when exactly ONE node has that address: `address:` in the
 *     node's config (a host, host:port or URL, or a list of them), or its key
 *     or `prometheus_node` as a host name (pi1, or pi1.lan).
 *  3. The monitor's name when exactly ONE node's key, `prometheus_node` or
 *     display name appears in it as a whole word (cadvisor-pi1 → pi1; vm101,
 *     vm-101 and "vm 101" are the same word).
 *
 * An ambiguous or empty answer from a step passes the choice to the next.
 * (refresh.js placeMonitor puts the monitor's owner or last-seen node between
 * 1 and 2, and the first node after 3.) Everything here is pure and
 * independent of the order nodes or monitors come in.
 */

/** @typedef {{ key: string, promNode?: string, displayName?: string, addresses: string[] }} NodeCandidate */

const MAX_HOST = 253;

/**
 * The host name in an address, a URL or a bare host, lower case; never the
 * credentials, port, path or query. Null when there is none.
 * @param {unknown} value
 * @returns {string | null}
 */
export function hostOf(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text === 'null' || text.length > 2048) return null;
  try {
    const url = new URL(text.includes('://') ? text : `http://${text}`);
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    return host && host.length <= MAX_HOST ? host : null;
  } catch {
    return null;
  }
}

/**
 * The host a Kuma monitor checks, from its /metrics labels: `monitor_hostname`
 * (Kuma writes "null" for none), else the host of `monitor_url`.
 * @param {{ monitor_hostname?: string, monitor_url?: string }} labels
 * @returns {string | null}
 */
export function targetHostOf(labels) {
  return hostOf(labels?.monitor_hostname) ?? hostOf(labels?.monitor_url);
}

const isIp = (/** @type {string} */ host) => /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':');

/** @param {unknown} v */
const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/**
 * The nodes a monitor can be placed on, from the board's node entries
 * ([key, config, data]).
 * @param {Array<[string, any, any]>} entries
 * @returns {NodeCandidate[]}
 */
export function candidatesOf(entries) {
  return entries
    .map(([key, cfg]) => ({
      key,
      promNode: typeof cfg?.prometheus_node === 'string' ? cfg.prometheus_node : undefined,
      displayName: typeof cfg?.display_name === 'string' ? cfg.display_name : undefined,
      addresses: asList(cfg?.address).map(hostOf).filter((h) => h !== null),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Step 1: the node `monitor_nodes` gives this monitor name (compared without
 * case), when it is a node on the board.
 * @param {unknown} monitorNodes
 * @param {string} name
 * @param {NodeCandidate[]} candidates
 * @returns {string | null}
 */
export function nodeBySetting(monitorNodes, name, candidates) {
  if (!monitorNodes || typeof monitorNodes !== 'object' || Array.isArray(monitorNodes)) return null;
  const lower = String(name).toLowerCase();
  const keys = Object.keys(monitorNodes).sort();
  const own = keys.find((k) => k === name) ?? keys.find((k) => k.toLowerCase() === lower);
  if (own === undefined) return null;
  const want = /** @type {Record<string, unknown>} */ (monitorNodes)[own];
  return typeof want === 'string' && candidates.some((c) => c.key === want) ? want : null;
}

/**
 * Step 2: the one node whose address the monitor's target host is.
 * @param {string | null | undefined} host
 * @param {NodeCandidate[]} candidates
 * @returns {string | null}
 */
export function nodeByTarget(host, candidates) {
  if (!host) return null;
  const label = host.split('.')[0];
  const first = isIp(host) || /^\d+$/.test(label) ? host : label;
  const hit = candidates.filter((c) => {
    if (c.addresses.includes(host)) return true;
    return [c.key, c.promNode].some((n) => typeof n === 'string' && n !== '' && [host, first].includes(n.toLowerCase()));
  });
  return hit.length === 1 ? hit[0].key : null;
}

/** Lower-case letters and digits of a text, in runs: "VM-101 b" → [vm, 101, b]. */
const segmentsOf = (/** @type {string} */ text) => String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Step 3: the one node a whole word of the monitor's name names. A word of a
 * node (its key, `prometheus_node` or display name) is its segments joined
 * (vm-101 → vm101) and must equal a run of whole segments of the name, so
 * `pi1` is in cadvisor-pi1 and cadvisor-pi1-b but not in pi10. A word of one
 * letter or digits only is no name for a node.
 * @param {string} monitorName
 * @param {NodeCandidate[]} candidates
 * @returns {string | null}
 */
export function nodeByName(monitorName, candidates) {
  const segs = segmentsOf(monitorName);
  if (segs.length === 0) return null;
  const runs = new Set();
  for (let i = 0; i < segs.length; i++) {
    let word = '';
    for (let j = i; j < segs.length; j++) {
      word += segs[j];
      runs.add(word);
    }
  }
  const hit = candidates.filter((c) =>
    [c.key, c.promNode, c.displayName].some((n) => {
      if (typeof n !== 'string') return false;
      const word = segmentsOf(n).join('');
      return word.length >= 2 && !/^\d+$/.test(word) && runs.has(word);
    })
  );
  return hit.length === 1 ? hit[0].key : null;
}

/**
 * Steps 2 and 3 for one monitor, the target host and then the name:
 * `{ nodeKey, by }`, or null when neither decides. (Step 1, the setting, is
 * nodeBySetting; placeMonitor puts the owner and last-seen node between them.)
 * @param {{ name: string, targetHost?: string | null }} monitor
 * @param {NodeCandidate[]} candidates
 * @returns {{ nodeKey: string, by: 'target' | 'name' } | null}
 */
export function inferMonitorNode(monitor, candidates) {
  const target = nodeByTarget(monitor.targetHost, candidates);
  if (target) return { nodeKey: target, by: 'target' };
  const named = nodeByName(monitor.name, candidates);
  if (named) return { nodeKey: named, by: 'name' };
  return null;
}
