import React from 'react';
import { cn } from '@ui/lib/utils';

/**
 * Horizontal, scrollable chips with per-chip counts.
 *
 * Props:
 *   chips    Array<{ id, label, count? }> — count shown after the label when provided.
 *   active   string — id of the currently active chip.
 *   onChange (id) => void — called when a chip is clicked.
 *   label    string — the group's name ("Filters" by default): a screen with
 *            two groups of chips names each (Alerts' "Severity" and "Kind").
 *
 * Bug #11 fixes applied here:
 *   - Each chip has a min-width so "All" stays a pill, never a lone circle.
 *   - Counts after the label: "All 17", "Down 2", "node-03 6".
 *   - Active chip = --accent-glow bg + --accent text/border (chrome, not status).
 *
 * 36px pills (#303) that wrap to a second line rather than
 * scroll out of sight, the pressed one in the accent's tint, edge and text
 * (chrome, never a status), its count in the same colour.
 */
export default function FilterChips({ chips, active, onChange, label = 'Filters' }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {chips.map((c) => {
        const on = active === c.id;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(c.id)}
            className={cn(
              'inline-flex h-9 min-w-12 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-3 text-body-sm font-semibold transition-colors',
              on
                ? 'border-accent-border bg-accent-tint text-accent-text'
                : 'border-border bg-surface-1 text-text-2 hover:bg-surface-2 hover:text-text-1'
            )}
          >
            {c.label}
            {c.count != null && (
              <>
                {' '}
                <span className={on ? 'text-accent-text' : 'text-text-3'}>{c.count}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
