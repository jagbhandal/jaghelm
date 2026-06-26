import React from 'react';

/** Horizontal, scrollable filter chips. active = current id; onChange(id). */
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
          {c.label}
        </button>
      ))}
    </div>
  );
}
