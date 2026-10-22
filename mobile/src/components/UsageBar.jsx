import React from 'react';

// The model's level for a reading → the fill's colour token. The bar judges
// nothing (#325): its colour is the reading's condition in /api/status.
const FILL = {
  ok: 'var(--green)',
  warn: 'var(--amber)',
  crit: 'var(--red)',
  unknown: 'var(--steel)',
};

/**
 * A labeled usage bar (CPU/MEM/DISK/TEMP). `percent` (0–100) drives the fill,
 * `shown` is the number as the model prints it ("94%", "86°C"), and `state`
 * is the model's level for the reading (its node's `conditions`; no signal
 * while the status is stale), which colours the fill. With no value (the
 * model didn't read it this cycle) the bar hides and shows a steel em-dash.
 * Track uses --border.
 */
export default function UsageBar({ label, shown, percent, state }) {
  const pct = Number.isFinite(percent) ? Math.max(0, Math.min(percent, 100)) : null;
  const isNull = pct == null || shown == null;
  return (
    <div className="usage-bar" data-state={state ?? undefined}>
      <div className="usage-bar__head">
        <span className="usage-bar__label">{label}</span>
        <span
          className="usage-bar__value"
          style={isNull ? { color: 'var(--steel)' } : undefined}
        >
          {isNull ? '—' : shown}
        </span>
      </div>
      {!isNull && (
        <div className="usage-bar__track">
          <div
            className="usage-bar__fill"
            style={{ width: `${pct}%`, background: FILL[state] ?? FILL.unknown }}
          />
        </div>
      )}
    </div>
  );
}
