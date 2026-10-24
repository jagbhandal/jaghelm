// @ts-check
/**
 * What Settings → Nodes & Services offers when a monitor is mapped to a
 * container (#319), read-only, from the services refresh's last cycle: for
 * each running container, which Kuma monitor it carries now, which one the
 * automatic matcher (monitors.js assignMonitors, #240) would pick on its own,
 * how that match was made, and the monitors with similar names. So a mapping
 * is chosen on purpose, not by fuzzy luck.
 *
 * The suggestion is the matcher run on this cycle's containers and monitors
 * with no explicit mapping at all: what "Auto-match" would do. The attached
 * monitor is what the cycle really assigned (it follows services.yaml's
 * mappings), so the two differ exactly where a mapping overrides the matcher.
 */
import { assignMonitors, scoreMatch } from './monitors.js';

// How good a kind of match is, the higher the better (monitors.js KIND_RANK).
/** @type {Record<string, number>} */
const KIND_RANK = { exact: 4, url: 3, contains: 2, word: 1 };
// How many similar monitors one container lists.
const CANDIDATES_MAX = 6;

/**
 * @param {{ nodes: Record<string, { services?: any[] }>, monitorOf?: Record<string, string>, monitors: Record<string, any>, nodeOrder?: string[] }} input
 *   `nodes` is the /api/services payload's; `monitorOf` (uid -> monitor id) is what the refresh keeps beside it;
 *   `monitors` is fetchMonitors' id -> monitor map.
 * @returns {Record<string, { attached: string|null, suggested: string|null, why: string|null, candidates: Array<{ name: string, kind: string }> }>}
 */
export function monitorMappingView({ nodes, monitorOf = {}, monitors, nodeOrder = Object.keys(nodes || {}) }) {
  /** @type {Array<{ container: string, nodeKey: string }>} */
  const running = [];
  for (const [nodeKey, node] of Object.entries(nodes || {})) {
    for (const s of node?.services ?? []) {
      if (s?.source === 'container' && typeof s.container === 'string') {
        running.push({ container: s.container, nodeKey });
      }
    }
  }
  const auto = assignMonitors({ candidates: running, monitors, services: {}, nodeOrder: /** @type {any} */ (nodeOrder) });
  const named = Object.values(monitors || {}).filter((m) => m && typeof m.name === 'string');
  /** @type {ReturnType<typeof monitorMappingView>} */
  const out = {};
  running.forEach((c, i) => {
    const uid = `${c.nodeKey}:${c.container}`;
    const id = monitorOf[uid];
    const attached = id != null ? (monitors?.[id]?.name ?? null) : null;
    const suggested = auto[i]?.name ?? null;
    /** @type {Array<{ name: string, kind: string, score: number }>} */
    const scored = [];
    for (const m of named) {
      const match = scoreMatch(c.container, m.name);
      if (match) scored.push({ name: m.name, kind: match.kind, score: match.score });
    }
    scored.sort(
      (a, b) =>
        KIND_RANK[b.kind] - KIND_RANK[a.kind] || b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    );
    out[uid] = {
      attached,
      suggested,
      why: suggested ? (scoreMatch(c.container, suggested)?.kind ?? null) : null,
      candidates: scored.slice(0, CANDIDATES_MAX).map(({ name, kind }) => ({ name, kind })),
    };
  });
  return out;
}
