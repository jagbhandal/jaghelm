import React from 'react';

/**
 * DegradedBanner — a compact, in-panel "this data source is unhealthy" notice.
 *
 * Two additive signals: `message` (a cause-naming line shown when a fetch
 * failed) and `staleNote` (a subtler "updated Nm ago" line when data is going
 * stale despite a technically-successful last fetch).
 */
export default function DegradedBanner({ message, staleNote, onRetry }) {
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
