/**
 * Display helpers for the phone screens: formatting and shaping only. The
 * app judges no state (#325, spec §6): every state, word and reason a screen
 * shows is the server's status model's (/api/status), drawn through
 * board.js. Nothing here has a severity table, a
 * threshold or a state of its own.
 * Nothing in this file imports React or does I/O.
 */

/** Format a uptime24 scalar (0–1) as "NN.N"; returns null when u is null/undefined. */
export function uptimePct(u) { return u != null ? (u * 100).toFixed(1) : null; }

/** Flatten { nodes:{key:{services}} } → flat Service[] tagged with nodeKey/nodeName. */
export function flattenServices(servicesBody) {
  const nodes = servicesBody && servicesBody.nodes;
  if (!nodes) return [];
  const out = [];
  for (const [nodeKey, node] of Object.entries(nodes)) {
    for (const svc of node.services || []) {
      out.push({ ...svc, nodeKey, nodeName: node.display_name || nodeKey });
    }
  }
  return out;
}

/**
 * Real wall-clock "HH:MM" from an epoch-ms number, numeric string, or ISO string.
 * Null-safe: returns null for null/empty/unparseable input (honest numbers — no
 * real datum, no clock). Pure (no I/O). Shared by RefreshStatus + IncidentDetail.
 */
export function formatClock(ts) {
  if (ts == null || ts === '') return null;
  const ms = typeof ts === 'number'
    ? ts
    : (/^\d+$/.test(String(ts).trim()) ? Number(ts) : Date.parse(ts));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
