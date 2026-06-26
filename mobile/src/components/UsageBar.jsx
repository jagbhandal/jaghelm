import React from 'react';

/**
 * A labeled usage bar (CPU/MEM/DISK/TEMP). `percent` (0–100) drives the fill;
 * null hides the bar and shows an em-dash. Severity tints at 75/90.
 */
export default function UsageBar({ label, value, unit = '', percent }) {
  const pct = Number.isFinite(percent) ? Math.max(0, Math.min(percent, 100)) : null;
  const color = pct == null ? 'var(--text-muted)' : pct >= 90 ? 'var(--red)' : pct >= 75 ? 'var(--amber)' : 'var(--green)';
  return (
    <div className="usage-bar">
      <div className="usage-bar__head">
        <span className="usage-bar__label">{label}</span>
        <span className="usage-bar__value">{value == null ? '—' : `${value}${unit}`}</span>
      </div>
      {pct != null && (
        <div className="usage-bar__track">
          <div className="usage-bar__fill" style={{ width: `${pct}%`, background: color }} />
        </div>
      )}
    </div>
  );
}
