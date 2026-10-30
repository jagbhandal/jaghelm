/*
 * StatTile (Monitoring spec §5 "Stat tiles"; #753): one number a chart does not
 * draw, such as the month's cost so far or the UPS's runtime. A label in 12px
 * text-2, the figure in text-1 at `text-title-sm` with tabular numerals, and an
 * optional `note` under it in 12px text-2 ("projected", "so far", "since the
 * 2nd"). It is a plain group (a term and its figure), read as "label: value,
 * note"; it carries no status colour (a figure is not a verdict: the status
 * model judges) and no chart slot.
 *
 * With no reading, pass `value={null}`: the tile says `emptyText` ("No
 * reading") in text-2, never a 0. `StatTiles` lays tiles out two to a row.
 */
import { cn } from './lib/utils.js';

function StatTile({ label, value, note, emptyText = 'No reading', className, ...props }) {
  const empty = value == null || value === '';
  return (
    <div
      data-slot="stat-tile"
      data-empty={empty ? 'true' : undefined}
      role="group"
      aria-label={`${label}: ${empty ? emptyText : value}${note ? `, ${note}` : ''}`}
      className={cn(
        'flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-surface-2 px-3 py-2',
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="text-caption text-text-2">
        {label}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'tabular-nums',
          empty ? 'text-body-sm text-text-2' : 'text-title-sm text-text-1'
        )}
      >
        {empty ? emptyText : value}
      </span>
      {note ? (
        <span aria-hidden="true" className="text-caption text-text-2">
          {note}
        </span>
      ) : null}
    </div>
  );
}

/** StatTiles: the tiles over a chart, two to a row. */
function StatTiles({ className, ...props }) {
  return (
    <div
      data-slot="monitoring-tiles"
      className={cn('grid grid-cols-2 gap-2', className)}
      {...props}
    />
  );
}

export { StatTile, StatTiles };
