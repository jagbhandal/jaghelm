import React, { useState, useEffect } from 'react';

/**
 * Pinned top status bar: shows when the data last refreshed and counts down to
 * the next refresh, with a progress line that fills over exactly one interval.
 * The cadence (`intervalMs`) is the server's configured refreshInterval, so this
 * stays in lockstep with the web dashboard's auto-refresh. Tap to refresh now.
 */
export default function RefreshStatus({ lastUpdated, intervalMs, error, loading, onRefresh }) {
  const [now, setNow] = useState(() => Date.now());

  // 1s heartbeat drives the relative time + countdown text only. The progress
  // line itself is a CSS animation (smooth, no per-frame JS).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const stale = !!error;
  const elapsed = lastUpdated == null ? null : Math.max(0, now - lastUpdated);
  const remainingS = elapsed == null ? null : Math.max(0, Math.ceil((intervalMs - elapsed) / 1000));

  let label;
  let next;
  if (stale) {
    label = lastUpdated == null ? 'Waiting for data' : `Last update ${formatAgo(elapsed)} ago`;
    next = 'Retrying…';
  } else if (lastUpdated == null) {
    label = loading ? 'Updating…' : 'Connecting…';
    next = '';
  } else {
    label = `Updated ${formatAgo(elapsed)} ago`;
    next = remainingS > 0 ? `Next in ${remainingS}s` : 'Updating…';
  }

  return (
    <button
      type="button"
      className={`mobile-statusbar${stale ? ' mobile-statusbar--stale' : ''}`}
      onClick={onRefresh}
      aria-label={stale ? 'Data refresh failed. Tap to retry.' : `${label}. Tap to refresh now.`}
    >
      <span className="mobile-statusbar__left">
        <span className="mobile-statusbar__dot" aria-hidden="true" />
        <span className="mobile-statusbar__label">{label}</span>
      </span>
      {next && <span className="mobile-statusbar__next">{next}</span>}
      {/* key restarts the fill animation on each successful refresh */}
      {!stale && lastUpdated != null && (
        <span
          key={lastUpdated}
          className="mobile-statusbar__progress"
          style={{ animationDuration: `${intervalMs}ms` }}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

/** "just now" | "12s" | "3m" | "2h" — compact, single unit. */
function formatAgo(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 1) return 'just now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}
