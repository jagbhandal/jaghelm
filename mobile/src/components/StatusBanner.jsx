import React from 'react';

/**
 * Non-interactive status banner shown when the backend is unreachable or data
 * is loading. Token-styled with var(--red*) for errors.
 */
export default function StatusBanner({ error, hasData }) {
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
