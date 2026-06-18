import React from 'react';

/**
 * DegradedBanner — a compact, in-panel "this data source is unhealthy" notice.
 *
 * Two independent, additive signals:
 *   - `message` (required): a short, CAUSE-NAMING line shown when a source's last
 *     fetch failed (e.g. "Live metrics unavailable — Prometheus unreachable").
 *     Rendered with role="alert" so assistive tech announces the degradation.
 *   - `staleNote` (optional): a subtle "updated Nm ago" line shown when the data
 *     is going stale (last success exceeded ~2 refresh intervals) even if the
 *     most recent fetch technically succeeded. Lower-key than the error line.
 *
 * Visual style mirrors ErrorBoundary's inline card (red top accent, glass-card,
 * ⚠️ + mono detail), so a degraded panel reads consistently with a crashed one.
 *
 * The "Retry" button calls `onRetry`, which forces an immediate full re-fetch.
 * It's a normal click handler — no per-render/per-tick state — so it can't
 * perturb the 304-stable-identity contract.
 */
export default function DegradedBanner({ message, staleNote, onRetry }) {
  // Nothing to say → render nothing (keeps the happy path visually unchanged).
  if (!message && !staleNote) return null;

  // An error is a louder signal than mere staleness; the red accent + alert role
  // only apply when there's an actual error message.
  const isError = Boolean(message);

  // No live region here: the text is visible, and the same global-source error
  // can render on many panels at once — a single page-level live region in
  // DashboardView announces each distinct cause once instead of N+M times.
  return (
    <div className={`degraded-banner ${isError ? 'is-error' : 'is-stale'}`}>
      <div className="degraded-banner-row">
        <span aria-hidden="true" className="degraded-banner-icon">
          {isError ? '⚠️' : '🕒'}
        </span>
        <div className="degraded-banner-text">
          {message && <div className="degraded-banner-message">{message}</div>}
          {staleNote && <div className="degraded-banner-stale">{staleNote}</div>}
        </div>
        {isError && onRetry && (
          <button
            type="button"
            className="settings-btn-sm degraded-banner-retry"
            onClick={onRetry}
            aria-label="Refresh all data sources"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
