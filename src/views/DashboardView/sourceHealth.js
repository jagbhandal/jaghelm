/**
 * Source-health presentation helpers for the dashboard's per-panel degraded /
 * stale banners. Pure functions — no React, no state — so they're trivially
 * testable and safe to call at render time without touching the
 * 304-stable-identity contract.
 *
 * The `sources` shape comes from useDashboardData:
 *   sources[key] = { error: string | null, lastSuccessMs: number | null }
 * with keys: services, ups, commits, cron, integrations.
 *
 * Each panel maps to the source that feeds it (see SOURCE_FOR_PANEL below).
 */

// Short, CAUSE-NAMING messages — each names the upstream that's unreachable so a
// degraded panel tells the user WHAT to go check, not just "something's wrong".
export const SOURCE_MESSAGES = {
  services: 'Live metrics unavailable — Prometheus unreachable',
  // The per-service up/down state on /api/services is sourced from Uptime Kuma
  // server-side; the navbar health dot polls it directly. Kept here so the same
  // distinct wording is available wherever monitor health is surfaced.
  monitors: 'Service status unavailable — Uptime Kuma unreachable',
  ups: 'UPS telemetry unavailable — NUT unreachable',
  commits: 'Pipeline activity unavailable — Gitea unreachable',
  cron: 'Job history unavailable — cron reporter unreachable',
  integrations: 'App metrics unavailable — integrations endpoint unreachable',
};

// How many refresh intervals of silence before a panel is flagged "stale".
const STALE_INTERVALS = 2;

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
 * Resolve the degraded/stale presentation for one source, computed AT RENDER
 * from the live `now` clock — no stored per-tick state. Returns:
 *   { message: string|null, staleNote: string|null }
 *
 * `key` selects the cause-naming copy from SOURCE_MESSAGES; if the source erred
 * but `key` has no canned message, the raw error string is shown as a fallback.
 *
 * - `message` is set when the source's last fetch errored.
 * - `staleNote` ("updated Nm ago") is set when the last SUCCESS is older than
 *   ~2 refresh intervals. Staleness and error are independent: a source can be
 *   both stale AND erroring (banner shows both lines), or stale without an error
 *   (last fetch 304'd fine but the upstream stopped changing long ago — unusual,
 *   but the note is harmless), or erroring while still recently-fresh.
 */
export function sourceBanner(source, key, refreshIntervalMs, now = Date.now()) {
  if (!source) return { message: null, staleNote: null };

  const message = source.error ? SOURCE_MESSAGES[key] || source.error : null;

  let staleNote = null;
  const last = source.lastSuccessMs;
  const interval =
    Number.isFinite(refreshIntervalMs) && refreshIntervalMs > 0 ? refreshIntervalMs : 30000;
  if (Number.isFinite(last) && now - last > STALE_INTERVALS * interval) {
    staleNote = `updated ${formatAgo(now - last)}`;
  }

  return { message, staleNote };
}
