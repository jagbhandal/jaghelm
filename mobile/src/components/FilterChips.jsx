import React from 'react';

/**
 * Horizontal, scrollable filter chips with per-chip counts.
 *
 * Props:
 *   chips    Array<{ id, label, count? }> — count shown inline when provided.
 *   active   string — id of the currently active chip.
 *   onChange (id) => void — called when a chip is clicked.
 *
 * Bug #11 fixes applied here:
 *   - Each chip has a min-width so "All" stays a pill, never a lone circle.
 *   - Padding is symmetric (handled in MobileApp.css .chip rule).
 *   - Right-edge scroll fade via mask-image on .filter-chips (MobileApp.css).
 *   - Counts rendered inline: "All 17", "Down 2", "node-03 6".
 *   - Active chip = --accent-glow bg + --accent text/border (chrome, not status).
 */
export default function FilterChips({ chips, active, onChange }) {
  return (
    <div className="filter-chips" role="group" aria-label="Filters">
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`chip${active === c.id ? ' chip--active' : ''}`}
          aria-pressed={active === c.id}
          onClick={() => onChange(c.id)}
        >
          {c.label}{c.count != null ? <>{' '}<span className="chip__count">{c.count}</span></> : ''}
        </button>
      ))}
    </div>
  );
}
