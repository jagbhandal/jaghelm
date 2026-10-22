/**
 * Display helpers for the mobile screens: formatting and shaping only. The
 * app judges no state (#325, spec §6): every state, word and reason a screen
 * shows is the server's status model's (/api/status), drawn through
 * board.js. noSeverity.test.js fails if a severity table, a threshold or a
 * state of the app's own comes back here or anywhere in mobile/src/.
 * Nothing in this file imports React or does I/O.
 */

/** Format a uptime24 scalar (0–1) as "NN.N"; returns null when u is null/undefined. */
export function uptimePct(u) { return u != null ? (u * 100).toFixed(1) : null; }

/**
 * CSS color token for a uptime24 scalar, the UptimeRing's arc. The model
 * doesn't judge a service's 24 h uptime, so this is the ring's own ramp, not a
 * status: it never colours a lamp, a word or a row.
 */
export function uptimeColor(u) {
  return u == null ? 'var(--text-muted)' : u > 0.99 ? 'var(--green)' : u > 0.95 ? 'var(--amber)' : 'var(--red)';
}

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
