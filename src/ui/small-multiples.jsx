/*
 * SmallMultiples (chart kit, #749; spec §5): one small line chart per entity
 * on a shared scale, the Monitoring section's "is this node's CPU off?"
 * (chart 4) and memory-and-swap (chart 5). On a phone the same cells are a
 * list of rows, each a title, its latest reading and a sparkline, that opens
 * the full chart on tap.
 *
 * `cells` are `[{ key, name, points, slot?, thresholds?, band?, highlighted? }]`:
 * `points` as the Chart's (numbers, or `{ time, value }`, a missing reading as
 * null, which breaks the line and is never drawn as 0). `slot` (0 to 5) is
 * the entity's colour, as in every other chart; without one it takes its place
 * in the list, and a seventh cell onwards is slot 1 (a cell holds one line, so
 * the colour is the entity's, not a state: status colour never draws it).
 *
 * The scale: 'shared' (default) gives every cell one value axis, from the
 * lowest to the highest reading of ALL cells and every threshold line, so a
 * node that is high looks high next to its neighbours; `zero` starts it at 0
 * (a magnitude). `domain` ([lo, hi]) fixes it instead (0 to 100 for a
 * percentage). `scale="own"` fits each cell to itself, for when the caller
 * says the cells are not comparable. The phone sparklines follow the same
 * choice.
 *
 * `also` on a cell (#757) is more lines in the same Chart, `[{ key, name, slot,
 * points }]` (memory and swap, two series per node): they take the cell's scale
 * and thresholds but not its latest figure, which is the cell's own `points`.
 * `seriesName` names the main line in the legend ("Memory"), else the cell's name.
 * A cell whose `also` has readings and `points` has none still says "No data"
 * for the main line; the caller words what the other line is. The phone's
 * sparklines draw the main line alone.
 *
 * `band` on a cell (#756) is the Chart's max band, `{ name?, points }`, the
 * highest reading in each step behind the cell's line (7 d and 30 d, where an
 * average hides a spike); the shared axis reaches its peaks too. The phone's
 * sparklines draw the line alone.
 *
 * `thresholds` (the Chart's, #746) are the caller's, from the one severity
 * table (status/thresholds.js): none are held here. Every cell draws them
 * with their words; a cell may bring its own. A cell whose latest reading is
 * at or past a line says so in words beside the figure (bold "Warn" or
 * "Critical" in the status `fg`), never in colour alone.
 *
 * Each cell: its name, the latest reading (`formatValue`; "No reading" where
 * the newest point is a gap), then a Chart of its own (so its crosshair, its
 * keyboard and its text summary are the Chart's). A cell with no reading at
 * all says "No data" in place of the plot: a node that is off is a gap, never
 * zero.
 *
 * `highlighted` on a cell (the Monitoring View graph, spec §4): the selected
 * ring (accent, violet: selected, never status) and a text tag, "Selected" or
 * the string given ("Warning · 91 % used"): in a grid cell's header, and on a
 * phone row on its own line under the name (#806).
 *
 * With `onOpen(key)` a grid cell's name is a button that opens the cell's
 * drill-down (#756); the cell's own Chart keeps its keyboard and crosshair.
 *
 * `aside` on a cell (#759, a string) is a second line of words under the
 * phone row's latest reading, for a figure the one sparkline does not draw
 * ("Swap 12 %", "No swap"): it is said in the row's name too. The grid shows
 * both lines in its Chart, so ignores it.
 *
 * `variant="phone"`: a list of rows, each at least 44px tall, the name and
 * its latest reading beside a 96px sparkline (always slot 1, decorative: the
 * row's name says it). With `onOpen(key)` each row is a button; without, a
 * plain row. `state` 'loading' and 'failed' are the Chart's in both variants,
 * one placeholder or message for the whole set, never empty cells that look
 * healthy.
 */
import { useMemo } from 'react';
import { cn } from './lib/utils.js';
import { hasText } from './lib/name.js';
import { isReading, normalise } from './lib/chart.js';
import { Chart, MAX_SERIES } from './chart.jsx';
import { Sparkline } from './sparkline.jsx';
import { StatusWord } from './status-word.jsx';

const WORDS = { warn: 'Warn', crit: 'Critical' };
const SELECTED = 'Selected';
const SPARK = Object.freeze({ width: 96, height: 24 });

/** A cell's readings, its newest point, and the reference lines it draws. */
function summarise(cell, shared) {
  const data = normalise(cell.points);
  const readings = data.map((d) => d.value).filter(isReading);
  const last = data.at(-1)?.value ?? null;
  const lines = (cell.thresholds ?? shared ?? []).filter(
    (t) => t && WORDS[t.level] && isReading(t.value)
  );
  const peaks = normalise(cell.band?.points ?? [])
    .map((d) => d.value)
    .filter(isReading);
  return { readings, last, lines, peaks };
}

/** The most severe line the reading is at or past, or null. */
function breach(last, lines) {
  if (last == null) return null;
  const hit = lines.filter((t) => (t.direction === 'below' ? last <= t.value : last >= t.value));
  return hit.find((t) => t.level === 'crit') ?? hit.find((t) => t.level === 'warn') ?? null;
}

const tagWords = (h) => (typeof h === 'string' && hasText(h) ? h : SELECTED);

function Latest({ info, formatValue, breached }) {
  if (!info.readings.length) {
    return (
      <span data-slot="small-multiples-latest" className="text-caption text-text-3">
        No data
      </span>
    );
  }
  return (
    <span className="flex items-baseline gap-1.5 text-body-sm">
      {breached && (
        <StatusWord
          state={breached.level}
          word={WORDS[breached.level]}
          className="text-caption"
          data-slot="small-multiples-breach"
        />
      )}
      {info.last == null ? (
        <span data-slot="small-multiples-latest" className="text-text-3">
          No reading
        </span>
      ) : (
        <span data-slot="small-multiples-latest" className="font-semibold text-text-1 tabular-nums">
          {formatValue(info.last)}
        </span>
      )}
    </span>
  );
}

// `wrap` is the phone's row (#806): the tag sits on its own line under the name and
// may wrap, so a long tag never takes the name's room. The grid keeps it on one line.
function Tag({ highlighted, wrap = false }) {
  return (
    <span
      data-slot="small-multiples-tag"
      className={cn(
        'rounded-sm bg-accent-tint px-1.5 text-caption font-semibold text-accent-text inset-ring inset-ring-accent-border',
        wrap ? 'self-start' : 'whitespace-nowrap'
      )}
    >
      {tagWords(highlighted)}
    </span>
  );
}

function SmallMultiples({
  label,
  cells = [],
  variant = 'grid',
  scale = 'shared',
  domain,
  zero = false,
  thresholds,
  formatValue = (v) => String(Math.round(v)),
  formatTime,
  formatTick,
  tickEvery,
  height = 96,
  state = 'ready',
  detail,
  failedText,
  onOpen,
  className,
  ...props
}) {
  if (!hasText(label)) {
    const message = 'SmallMultiples needs a `label`: it has no name';
    if (import.meta.env.DEV) throw new Error(message);
    console.error(message);
  }

  const infos = useMemo(() => cells.map((c) => summarise(c, thresholds)), [cells, thresholds]);

  // One axis for every cell: every reading and every reference line, all cells.
  const shared = useMemo(() => {
    if (Array.isArray(domain)) return domain;
    if (scale === 'own') return null;
    const reach = infos.flatMap((i) => [...i.readings, ...i.peaks, ...i.lines.map((t) => t.value)]);
    if (!reach.length) return null;
    const lo = Math.min(...reach);
    return [zero ? Math.min(0, lo) : lo, Math.max(...reach)];
  }, [infos, domain, scale, zero]);

  const own = zero ? 'zero' : 'auto';
  const chartProps = {
    ...(formatTime && { formatTime }),
    ...(formatTick && { formatTick }),
    ...(tickEvery && { tickEvery }),
    formatValue,
  };

  // ── Not drawn: loading or failed, for the whole set ──
  if (state !== 'ready') {
    return (
      <div
        data-slot="small-multiples"
        data-state={state}
        className={cn('min-w-0', className)}
        {...props}
      >
        <Chart
          label={label}
          series={[]}
          state={state}
          detail={detail}
          {...(failedText && { failedText })}
          height={variant === 'phone' ? 72 : height}
        />
      </div>
    );
  }

  const slotOf = (c, i) => {
    if (Number.isInteger(c.slot) && c.slot >= 0 && c.slot < MAX_SERIES) return c.slot;
    return i < MAX_SERIES ? i : 0;
  };

  if (variant === 'phone') {
    return (
      <ul
        data-slot="small-multiples"
        data-variant="phone"
        aria-label={label}
        className={cn('m-0 flex min-w-0 list-none flex-col divide-y divide-border p-0', className)}
        {...props}
      >
        {cells.map((c, i) => {
          const info = infos[i];
          const hit = breach(info.last, info.lines);
          const highlighted = c.highlighted;
          const said = !info.readings.length
            ? 'No data'
            : info.last == null
              ? 'No reading'
              : formatValue(info.last);
          const aside = hasText(c.aside) ? c.aside : null;
          const name = [c.name, hit && WORDS[hit.level], said, aside].filter(Boolean).join(', ');
          const body = (
            <>
              <span className="flex min-w-0 flex-1 flex-col justify-center">
                <span className="truncate text-body text-text-1">{c.name}</span>
                {highlighted && <Tag highlighted={highlighted} wrap />}
                <Latest info={info} formatValue={formatValue} breached={hit} />
                {aside && (
                  <span data-slot="small-multiples-aside" className="text-caption text-text-2">
                    {aside}
                  </span>
                )}
              </span>
              {info.readings.length > 1 ? (
                <Sparkline decorative points={c.points} domain={shared ?? 'auto'} {...SPARK} />
              ) : (
                <span aria-hidden="true" style={{ width: SPARK.width }} className="shrink-0" />
              )}
            </>
          );
          const row = cn(
            'flex min-h-11 w-full min-w-0 items-center gap-3 px-3.5 py-2 text-left',
            highlighted && 'inset-ring-[1.5px] inset-ring-accent'
          );
          return (
            <li
              key={c.key}
              data-slot="small-multiples-cell"
              data-state={!info.readings.length ? 'empty' : hit ? hit.level : 'ok'}
              data-highlighted={highlighted ? '' : undefined}
              className="m-0 p-0"
            >
              {onOpen ? (
                <button
                  type="button"
                  aria-label={`${name}. Open the chart`}
                  onClick={() => onOpen(c.key)}
                  className={cn(
                    row,
                    'cursor-pointer bg-surface-1 text-text-1 -outline-offset-2 hover:bg-surface-2'
                  )}
                >
                  {body}
                </button>
              ) : (
                <div className={cn(row, 'bg-surface-1')}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="@container min-w-0">
      <ul
        data-slot="small-multiples"
        data-variant="grid"
        aria-label={label}
        className={cn(
          'm-0 grid min-w-0 list-none grid-cols-1 gap-3 p-0 @sm:grid-cols-2 @3xl:grid-cols-3',
          className
        )}
        {...props}
      >
        {cells.map((c, i) => {
          const info = infos[i];
          const hit = breach(info.last, info.lines);
          const highlighted = c.highlighted;
          const empty = !info.readings.length;
          return (
            <li
              key={c.key}
              data-slot="small-multiples-cell"
              data-state={empty ? 'empty' : hit ? hit.level : 'ok'}
              data-highlighted={highlighted ? '' : undefined}
              className={cn(
                'm-0 flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-surface-1 p-3',
                highlighted && 'border-transparent inset-ring-[1.5px] inset-ring-accent'
              )}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  {onOpen ? (
                    <button
                      type="button"
                      data-slot="small-multiples-name"
                      aria-label={`${c.name}. Open the chart`}
                      onClick={() => onOpen(c.key)}
                      className="min-w-0 cursor-pointer truncate rounded-xs text-left text-body-sm font-semibold text-text-1 underline-offset-2 hover:underline focus-visible:underline"
                    >
                      {c.name}
                    </button>
                  ) : (
                    <span
                      data-slot="small-multiples-name"
                      className="truncate text-body-sm font-semibold text-text-1"
                    >
                      {c.name}
                    </span>
                  )}
                  {highlighted && <Tag highlighted={highlighted} />}
                </span>
                <Latest info={info} formatValue={formatValue} breached={hit} />
              </div>
              {empty ? (
                <div
                  role="img"
                  aria-label={`${c.name}, ${label}: No data`}
                  style={{ height }}
                  className="flex items-center justify-center border-b border-border px-4 text-center"
                >
                  <span data-slot="small-multiples-empty" className="text-body-sm text-text-2">
                    No data
                  </span>
                </div>
              ) : (
                <Chart
                  label={`${c.name}, ${label}`}
                  series={[
                    { key: c.key, name: c.seriesName ?? c.name, slot: slotOf(c, i), points: c.points },
                    ...(c.also ?? []),
                  ]}
                  domain={shared ?? own}
                  height={height}
                  thresholds={c.thresholds ?? thresholds}
                  band={c.band}
                  {...chartProps}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { SmallMultiples };
