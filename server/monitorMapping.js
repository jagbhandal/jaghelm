// @ts-check
/**
 * What Settings → Nodes & Services offers when a monitor is mapped to a
 * container (#319), read-only, from the services refresh's last cycle: for
 * each container on the board, the Kuma monitor it carries, the one Auto-match
 * would pick if its own mapping were cleared and how that match was made, the
 * monitors with similar names, and the monitors that other mappings hold. So a
 * mapping is chosen on purpose, not by fuzzy luck.
 *
 * There is no matching code here: every answer is monitors.js assignMonitors,
 * the matcher the refresh runs, on the same containers (running ones, and the
 * stopped ones the board still shows as presence cards), Kuma's monitors and
 * the real `services:` mappings.
 *  - `attached` is that run as it stands: what the container carries.
 *  - `suggested` is the same run with only this container's mapping on this
 *    node removed (the other nodes of a container-wide mapping keep it): what
 *    Auto-match would do if it were cleared. A container with no mapping of its
 *    own has nothing to remove, so its suggestion is its attached monitor. A
 *    monitor another mapping holds is never suggested, because the matcher
 *    keeps it for that mapping.
 *  - `held` maps each monitor another container's mapping names to that
 *    `{ container, node }`, so Settings can refuse to pin it twice (two
 *    containers on one monitor are two red cards and two pushes).
 */
import { assignMonitors, isFreshMonitor, mappingOf, scoreMatch } from './monitors.js';

/** @type {Record<string, number>} */
const KIND_RANK = { exact: 4, url: 3, contains: 2, word: 1 };
// How many similar monitors one container lists.
const CANDIDATES_MAX = 6;

const isMap = (/** @type {unknown} */ v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * `services` with the mapping of `container` on `nodeKey` removed. A
 * container-wide `monitor` is moved onto the board's other nodes first, so they keep it.
 * @param {Record<string, any>} services
 * @param {string} container
 * @param {string} nodeKey
 * @param {string[]} nodeKeys
 */
function withoutMapping(services, container, nodeKey, nodeKeys) {
  const entry = services[container];
  if (!isMap(entry)) return services;
  const next = { ...entry };
  const perNode = { ...(isMap(entry.monitor_per_node) ? entry.monitor_per_node : {}) };
  if (entry.monitor !== undefined && entry.monitor !== null && entry.monitor !== '') {
    for (const k of nodeKeys) if (k !== nodeKey && !Object.hasOwn(perNode, k)) perNode[k] = entry.monitor;
  }
  delete next.monitor;
  delete perNode[nodeKey];
  next.monitor_per_node = perNode;
  return { ...services, [container]: next };
}

/**
 * @param {{ nodes: Record<string, { services?: any[] }>, monitorOf?: Record<string, string>, monitors: Record<string, any>, services?: Record<string, any>, nodeOrder?: string[] }} input
 *   `nodes` is the /api/services payload's; `monitorOf` (uid -> monitor id) is what the refresh keeps beside it
 *   (used only for a monitor's own red card); `monitors` is fetchMonitors' id -> monitor map; `services` is services.yaml's.
 * @returns {Record<string, { attached: string|null, paused: boolean, suggested: string|null, why: string|null, candidates: Array<{ name: string, kind: string }>, held: Record<string, { container: string, node: string }> }>}
 */
export function monitorMappingView({ nodes, monitorOf = {}, monitors, services = {}, nodeOrder = Object.keys(nodes || {}) }) {
  /** @type {Array<{ container: string, nodeKey: string, stopped?: boolean }>} */
  const candidates = [];
  /** @type {number[]} */
  const runningAt = [];
  /** @type {Array<{ uid: string, name: string | null }>} */
  const monitorCards = [];
  for (const [nodeKey, node] of Object.entries(nodes || {})) {
    for (const s of node?.services ?? []) {
      if (typeof s?.container !== 'string') continue;
      if (s.source === 'container') {
        runningAt.push(candidates.length);
        candidates.push({ container: s.container, nodeKey });
      } else if (s.source === 'presence') {
        candidates.push({ container: s.container, nodeKey, stopped: true });
      } else if (s.source === 'monitor') {
        monitorCards.push({ uid: s.uid ?? `${nodeKey}:${s.container}`, name: s.container });
      }
    }
  }
  const nodeKeys = Object.keys(nodes || {});
  const run = (/** @type {Record<string, any>} */ withServices) =>
    assignMonitors({ candidates, monitors, services: withServices, nodeOrder: /** @type {any} */ (nodeOrder) });
  const base = run(services);
  const named = Object.values(monitors || {}).filter((m) => m && typeof m.name === 'string');
  const byLower = new Map(named.map((m) => [m.name.toLowerCase(), m]));

  // Which container on which node each monitor is explicitly mapped to.
  /** @type {Array<{ lower: string, container: string, node: string }>} */
  const holds = [];
  for (const c of candidates) {
    const m = mappingOf(services, c.container, c.nodeKey);
    if (m && typeof m.monitor === 'string') holds.push({ lower: m.monitor.toLowerCase(), container: c.container, node: c.nodeKey });
  }

  /** @type {ReturnType<typeof monitorMappingView>} */
  const out = {};
  for (const i of runningAt) {
    const c = candidates[i];
    const uid = `${c.nodeKey}:${c.container}`;
    const own = mappingOf(services, c.container, c.nodeKey);
    const suggestedMonitor = own ? run(withoutMapping(services, c.container, c.nodeKey, nodeKeys))[i] : base[i];
    const attached = base[i];
    const scored = [];
    for (const m of named) {
      const match = scoreMatch(c.container, m.name);
      if (match) scored.push({ name: m.name, kind: match.kind, score: match.score });
    }
    scored.sort(
      (a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind] || b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    );
    /** @type {Record<string, { container: string, node: string }>} */
    const held = {};
    for (const h of holds) {
      if (h.container === c.container && h.node === c.nodeKey) continue;
      const m = byLower.get(h.lower);
      if (m && !held[m.name]) held[m.name] = { container: h.container, node: h.node };
    }
    out[uid] = {
      attached: attached?.name ?? null,
      paused: attached ? !isFreshMonitor(attached) : false,
      suggested: suggestedMonitor?.name ?? null,
      why: suggestedMonitor ? (scoreMatch(c.container, suggestedMonitor.name)?.kind ?? null) : null,
      candidates: scored.slice(0, CANDIDATES_MAX).map(({ name, kind }) => ({ name, kind })),
      held,
    };
  }
  // A monitor's own red card: the monitor it is, so its tag can name it.
  for (const { uid } of monitorCards) {
    const m = monitors?.[monitorOf[uid]];
    out[uid] = {
      attached: m?.name ?? null,
      paused: m ? !isFreshMonitor(m) : false,
      suggested: null,
      why: null,
      candidates: [],
      held: {},
    };
  }
  return out;
}

/**
 * The Kuma monitors no container carries and the node each one is on (#644),
 * for the Node choice in Settings: every one the last refresh placed (a down
 * one has a red card, an up or pending one none), by name, with the way it was
 * placed (`by`: setting, owner, last-seen, target, name or first) and Kuma's
 * state. Read from the refresh's own placement, nothing is worked out again.
 * @param {{ monitorPlaced?: Record<string, { monitor: string, node: string, by: string }>, monitorOf?: Record<string, string>, monitors?: Record<string, any> }} input
 * @returns {Array<{ uid: string, monitor: string, node: string, by: string, status: string }>}
 */
export function monitorOnlyView({ monitorPlaced = {}, monitorOf = {}, monitors = {} }) {
  return Object.entries(monitorPlaced)
    .map(([uid, p]) => ({
      uid,
      monitor: p.monitor,
      node: p.node,
      by: p.by,
      status: monitors?.[monitorOf[uid]]?.kumaStatus ?? 'unknown',
    }))
    .sort((a, b) => (a.monitor < b.monitor ? -1 : a.monitor > b.monitor ? 1 : a.uid < b.uid ? -1 : 1));
}
