/**
 * Source-health presentation helpers for the Overview's sections' banners
 * ("these are the last readings it had"). Pure functions — no React, no
 * state — so they're trivially testable and safe to call at render time
 * without touching the 304-stable-identity contract.
 *
 * The `sources` shape comes from useDashboardData, which judges how old each
 * source's last answer is (by the client's one rule, on the one clock,
 * freshness.js, #559):
 *   sources[key] = { error: string | null, staleNote: string | null }
 * with keys: services, integrations.
 */

// Short, CAUSE-NAMING messages — each names the upstream that's unreachable,
// so the screen tells the user WHAT to go check, not just "something's wrong".
// The Overview announces them once, in one live region (OverviewBoard.jsx).
export const SOURCE_MESSAGES = {
  services: 'Live metrics unavailable — Prometheus unreachable',
  integrations: 'App metrics unavailable — integrations endpoint unreachable',
};

/**
 * Human "Nm ago" / "Ns ago" / "Nh ago" for a millisecond age. Compact by design
 * — this is a subtle secondary note, not a headline.
 */
export function formatAgo(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * A healthy source's banner: one frozen object, so an Overview whose sources
 * stay healthy hands its sections the same banner every step, and their memos
 * hold (a new one each step re-rendered every panel on every tick, #252).
 */
export const HEALTHY = Object.freeze({ message: null, staleNote: null });

/**
 * The degraded/stale presentation for one source, from what useDashboardData
 * said of it. Returns:
 *   { message: string|null, staleNote: string|null }
 *
 * `key` selects the cause-naming copy from SOURCE_MESSAGES; if the source erred
 * but `key` has no canned message, the raw error string is shown as a fallback.
 *
 * - `message` is set when the source's last fetch errored.
 * - `staleNote` ("updated Nm ago", the real age of its last success) is set
 *   once its last answer is stale (useDashboardData, by the one rule the
 *   header's status follows too: two polls and the request timeout).
 *   Staleness and error are independent: a source can be both stale AND
 *   erroring (banner shows both lines), or stale without an error (its
 *   requests hang), or erroring while still recently-fresh.
 * - A healthy source (neither) gets HEALTHY, the same object every time.
 */
export function sourceBanner(source, key) {
  if (!source) return HEALTHY;
  const message = source.error ? SOURCE_MESSAGES[key] || source.error : null;
  const staleNote = source.staleNote || null;
  return message || staleNote ? { message, staleNote } : HEALTHY;
}
