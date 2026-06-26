import React from 'react';

/**
 * Non-interactive status banner: shows a loading paragraph when loading and
 * no data yet, an error banner when the backend is unreachable, or nothing
 * when all is well. Token-styled with var(--red*) for errors.
 */
export default function StatusBanner({ loading, error, hasData }) {
  if (loading && !hasData) {
    return <p className="mobile-view__todo">Loading…</p>;
  }
  if (!error) return null;
  const msg = hasData
    ? "Couldn't reach JagHelm — showing last known data"
    : "Couldn't reach JagHelm";
  return (
    <div
      className="status-banner status-banner--error"
      role="alert"
      aria-live="polite"
    >
      {msg}
    </div>
  );
}
