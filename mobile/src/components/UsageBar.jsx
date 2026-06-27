import React from 'react';

/**
 * A labeled usage bar (CPU/MEM/DISK/TEMP). `percent` (0–100) drives the fill;
 * null/non-numeric percent hides the bar and shows a steel em-dash. Fill is
 * colored worst-of: ≥90 red, ≥75 amber, else green. Track uses --border.
 */
export default function UsageBar({ label, value, unit = '', percent }) {
  const pct = Number.isFinite(percent) ? Math.max(0, Math.min(percent, 100)) : null;
  const fillColor = pct == null ? null : pct >= 90 ? 'var(--red)' : pct >= 75 ? 'var(--amber)' : 'var(--green)';
  const isNull = pct == null || value == null;
  return (
    <div className="usage-bar">
      <div className="usage-bar__head">
        <span className="usage-bar__label">{label}</span>
        <span
          className="usage-bar__value"
          style={isNull ? { color: 'var(--steel)' } : undefined}
        >
          {isNull ? '—' : `${value}${unit}`}
        </span>
      </div>
      {pct != null && (
        <div className="usage-bar__track">
          <div className="usage-bar__fill" style={{ width: `${pct}%`, background: fillColor }} />
        </div>
      )}
    </div>
  );
}
