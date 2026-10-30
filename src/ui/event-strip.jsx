/*
 * EventStrip (spec: Monitoring section, chart kit; #750): a timeline of
 * discrete events, one row per entity, on one time axis: a container's
 * restarts and OOM kills. The Chart (chart.jsx) draws readings; this draws
 * moments.
 *
 * `rows` are `[{ key, name, slot?, events }]`, each event `{ key?, time,
 * kind, detail? }` (time in ms or a Date, `kind` a key of `kinds`, `detail` a
 * short sentence: "exit 137, 3 restarts in an hour"). A row with no event
 * between `from` and `to` is not drawn; with no event in range at all the
 * strip says `emptyText` (the caller's words, "No restarts or OOM kills in
 * the last 24 hours"), never an empty plot that looks healthy.
 *
 * `kinds` are `[{ key, word, shape }]`: the word the legend, the tooltip and
 * the text list print ("Restart"), and the mark's shape, one of SHAPES. A
 * kind is told by its shape and its word, never by colour alone. The default
 * kinds are a restart (a circle) and an OOM kill (a cross). A mark is
 * drawn in its row's chart slot (docs/design-system.md, "Chart colours"):
 * `slot` (0-based) or the row's place in the list, so the colour follows the
 * entity, in the same slot the line charts give it; a seventh row and on are
 * drawn in text-2. A mark never takes a status colour, even for an OOM kill:
 * the state shows in the status components.
 *
 * The axis: `from` and `to` (ms) are the shared time axis. Inside a
 * ChartGroup (chart.jsx) the strip takes the group's three columns as a
 * subgrid (row names in the first, the plot in the second), so its plot
 * starts at the same x and is as wide as the charts' above it, and `from`,
 * `to` and `tickEvery` should be the charts' own: the same times line up.
 * Without `from` and `to` the axis fits the events.
 *
 * Reach: the plot is an image named by `label` and described by a count and
 * the keys; the same events are a text list (`sr-only`, one item each: row,
 * kind, time, detail) beside it, so nothing lives only in the tooltip or the
 * marks. Tab reaches the plot and focus puts a marker on the latest event;
 * the arrows step through the events in time order, Home and End jump,
 * Escape hides the marker, and a polite live region says each event the
 * keys reach. The pointer shows the event under it. Its tooltip is the time
 * and kind (then the entity and the detail).
 *
 * `state`: 'ready', 'loading' (a placeholder), 'failed' ("No data from
 * Prometheus", or `failedText`; `detail` says why).
 */
import { useId, useLayoutEffect, useMemo, useRef, useState, useContext } from 'react';
import { cn } from './lib/utils.js';
import { hasText } from './lib/name.js';
import { evenTicks, round2, timeTicks } from './lib/chart.js';
import { ChartGroupContext } from './chart.jsx';
import { dateTimeFormat } from '../util/format.js';

/** The slots' fills and strokes, written out so Tailwind finds them. */
const FILL = [
  'fill-series-1',
  'fill-series-2',
  'fill-series-3',
  'fill-series-4',
  'fill-series-5',
  'fill-series-6',
];
const STROKE = [
  'stroke-series-1',
  'stroke-series-2',
  'stroke-series-3',
  'stroke-series-4',
  'stroke-series-5',
  'stroke-series-6',
];
const MAX_SLOTS = FILL.length;

/** The mark shapes a kind can take. */
export const SHAPES = Object.freeze(['circle', 'diamond', 'triangle', 'square', 'cross']);

/** Restarts and OOM kills, the strip's first use (spec chart 7). */
export const DEFAULT_KINDS = Object.freeze([
  { key: 'restart', word: 'Restart', shape: 'circle' },
  { key: 'oom', word: 'OOM kill', shape: 'cross' },
]);

const MINUTE = 60_000;
const HM = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
const defaultTime = (/** @type {number} */ t) => dateTimeFormat(HM).format(new Date(t));
const toMs = (/** @type {number | Date} */ t) => (t instanceof Date ? t.getTime() : t);

// Mark radius, the ring around the active one, the strip's room above and
// below its rows and at its right, the hit radius of a pointer.
const R = 5;
const RING = 9;
const PAD = 6;
const HIT = 14;

/** The path of a mark of `shape` centred on (x, y); a cross is two strokes. */
function markPath(shape, x, y) {
  switch (shape) {
    case 'diamond':
      return `M${x} ${y - R - 1}L${x + R + 1} ${y}L${x} ${y + R + 1}L${x - R - 1} ${y}Z`;
    case 'triangle':
      return `M${x} ${y - R - 1}L${x + R + 1} ${y + R}L${x - R - 1} ${y + R}Z`;
    case 'square':
      return `M${x - R} ${y - R}H${x + R}V${y + R}H${x - R}Z`;
    case 'cross':
      return `M${x - R} ${y - R}L${x + R} ${y + R}M${x + R} ${y - R}L${x - R} ${y + R}`;
    default:
      return `M${x - R} ${y}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0Z`;
  }
}

/** A kind's mark as a small key, for the legend and the tooltip (neutral, text-2). */
function ShapeKey({ shape, className }) {
  return (
    <svg
      data-slot="event-strip-key"
      data-shape={shape}
      width="14"
      height="14"
      viewBox="-7 -7 14 14"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0 overflow-visible', className)}
    >
      <path
        d={markPath(shape, 0, 0)}
        className={shape === 'cross' ? 'fill-none stroke-text-2' : 'fill-text-2'}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * @param {{
 *   label: string,
 *   rows?: { key: string, name: string, slot?: number, events?: { key?: string, time: number | Date, kind: string, detail?: string }[] }[],
 *   kinds?: readonly { key: string, word: string, shape: string }[],
 *   from?: number | Date,
 *   to?: number | Date,
 *   rowHeight?: number,
 *   height?: number,
 *   formatTime?: (t: number) => string,
 *   formatTick?: (t: number) => string,
 *   tickEvery?: number,
 *   state?: 'ready' | 'loading' | 'failed',
 *   detail?: string,
 *   failedText?: string,
 *   emptyText?: string,
 *   className?: string,
 * } & Record<string, any>} props
 */
function EventStrip({
  label,
  rows = [],
  kinds = DEFAULT_KINDS,
  from,
  to,
  rowHeight = 28,
  height = 64,
  formatTime = defaultTime,
  formatTick = defaultTime,
  tickEvery = 15 * MINUTE,
  state = 'ready',
  detail,
  failedText = 'No data from Prometheus',
  emptyText = 'No events in this range',
  className,
  ...props
}) {
  const id = useId();
  const grouped = useContext(ChartGroupContext);
  const plotRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [plotWidth, setPlotWidth] = useState(/** @type {number | null} */ (null));
  const [active, setActive] = useState(/** @type {number | null} */ (null));
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [said, setSaid] = useState('');
  const touched = useRef(false);

  if (!hasText(label)) {
    const message = 'EventStrip needs a `label`: it has no name';
    if (import.meta.env.DEV) throw new Error(message);
    console.error(message);
  }

  const kindOf = useMemo(() => new Map(kinds.map((k) => [k.key, k])), [kinds]);
  const fromMs = from == null ? null : toMs(from);
  const toMsValue = to == null ? null : toMs(to);

  // Rows with an event in range, in the caller's order; events by time.
  const { drawnRows, events, t0, t1 } = useMemo(() => {
    const all = rows.flatMap((r) => (r.events ?? []).map((e) => ({ ...e, time: toMs(e.time) })));
    const finite = all.filter((e) => Number.isFinite(e.time));
    const lo = fromMs ?? (finite.length ? Math.min(...finite.map((e) => e.time)) : 0);
    let hi = toMsValue ?? (finite.length ? Math.max(...finite.map((e) => e.time)) : 0);
    // One event alone (or all at once) still gets a span to sit in.
    if (!(hi > lo)) hi = lo + MINUTE;
    const kept = [];
    let order = 0;
    rows.forEach((r, ri) => {
      const mine = (r.events ?? [])
        .map((e) => ({ ...e, time: toMs(e.time) }))
        .filter((e) => Number.isFinite(e.time) && e.time >= lo && e.time <= hi);
      if (!mine.length) return;
      const row = {
        key: r.key,
        name: r.name,
        slot:
          Number.isInteger(r.slot) && r.slot >= 0 && r.slot < MAX_SLOTS
            ? r.slot
            : ri < MAX_SLOTS
              ? ri
              : null,
        index: kept.length,
        events: mine.map((e) => ({
          ...e,
          id: `${r.key}:${e.key ?? order}`,
          order: order++,
          kindInfo: kindOf.get(e.kind) ?? { key: e.kind, word: String(e.kind), shape: 'circle' },
        })),
      };
      kept.push(row);
    });
    const flat = kept
      .flatMap((r) =>
        r.events.map((e) => ({ ...e, rowKey: r.key, rowName: r.name, rowIndex: r.index }))
      )
      .sort((a, b) => a.time - b.time || a.rowIndex - b.rowIndex || a.order - b.order);
    return { drawnRows: kept, events: flat, t0: lo, t1: hi };
  }, [rows, fromMs, toMsValue, kindOf]);

  const drawable = state === 'ready' && events.length > 0;

  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width * 100) / 100;
      setPlotWidth(w > 0 ? w : null);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [drawable]);

  const w = plotWidth ?? 400;
  const plotH = drawnRows.length * rowHeight + PAD * 2;
  const geo = useMemo(() => {
    if (!drawable) return null;
    const span = t1 - t0;
    const xOf = (/** @type {number} */ t) => round2(((t - t0) / span) * w);
    const placed = events.map((e) => ({
      ...e,
      x: xOf(e.time),
      y: PAD + e.rowIndex * rowHeight + rowHeight / 2,
    }));
    const xTicks = evenTicks(
      timeTicks(t0, t1, tickEvery).map((t) => ({ t, x: xOf(t) })),
      { width: w, every: tickEvery, span, labelOf: formatTick }
    );
    return { placed, xTicks };
  }, [drawable, events, t0, t1, w, rowHeight, tickEvery, formatTick]);

  const last = events.length - 1;
  const open =
    geo != null && active != null && active <= last && !dismissed && (hovering || focused);
  const current = open && geo ? geo.placed[/** @type {number} */ (active)] : null;

  const words = (/** @type {any} */ e) =>
    `${e.rowName}: ${e.kindInfo.word} at ${formatTime(e.time)}${hasText(e.detail) ? `, ${e.detail}` : ''}`;

  const usedKinds = useMemo(() => {
    const seen = new Map();
    events.forEach((e) => seen.set(e.kindInfo.key, e.kindInfo));
    return [...seen.values()];
  }, [events]);

  const summary = useMemo(() => {
    if (!drawable) return '';
    const n = events.length;
    return `${n} ${n === 1 ? 'event' : 'events'} in ${drawnRows.length} ${drawnRows.length === 1 ? 'row' : 'rows'}, latest ${formatTime(events[last].time)}. The arrow keys step through them.`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the formatter is the caller's
  }, [drawable, events, drawnRows.length, last]);

  const move = (/** @type {number | null} */ i) => {
    setActive(i);
    setDismissed(false);
  };

  const onPointerMove = (/** @type {import('react').PointerEvent} */ e) => {
    if (!geo) return;
    const box = plotRef.current?.getBoundingClientRect();
    if (!box?.width) return;
    const x = ((e.clientX - box.left) / box.width) * w;
    const y = e.clientY - box.top;
    let best = null;
    let bestD = HIT;
    geo.placed.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    });
    setHovering(best != null);
    if (best != null && best !== active) move(best);
    if (best == null && !focused) setActive(null);
  };
  const onPointerLeave = () => {
    setHovering(false);
    if (!focused) setActive(null);
  };
  const onPointerDown = (/** @type {import('react').PointerEvent<HTMLDivElement>} */ e) => {
    touched.current = e.pointerType !== 'mouse';
    if (!touched.current) return;
    onPointerMove(e);
  };
  const onPointerUp = (/** @type {import('react').PointerEvent} */ e) => {
    if (e.pointerType === 'mouse') return;
    setHovering(false);
    setActive(null);
  };

  /** @type {Record<string, (i: number) => number>} */
  const KEYS = {
    ArrowLeft: (i) => Math.max(i - 1, 0),
    ArrowUp: (i) => Math.max(i - 1, 0),
    ArrowRight: (i) => Math.min(i + 1, last),
    ArrowDown: (i) => Math.min(i + 1, last),
    Home: () => 0,
    End: () => last,
  };
  const onKeyDown = (/** @type {import('react').KeyboardEvent} */ e) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setDismissed(true);
      }
      return;
    }
    const to = KEYS[e.key];
    if (!to || !geo) return;
    e.preventDefault();
    const next = to(active ?? last);
    move(next);
    setSaid(words(events[next]));
  };

  // ── Not drawn: loading, failed, nothing in range ──
  if (!drawable) {
    const loading = state === 'loading';
    const failed = state === 'failed';
    const message = failed ? failedText : emptyText;
    return (
      <figure
        data-slot="event-strip"
        data-state={loading ? 'loading' : failed ? 'failed' : 'empty'}
        className={cn('m-0 flex min-w-0 flex-col', grouped && 'col-span-full', className)}
        {...props}
      >
        {loading ? (
          <div aria-busy="true" style={{ height }} className="flex flex-col justify-end">
            <span className="sr-only">{`${label}: loading`}</span>
            <div aria-hidden="true" className="h-full rounded-md bg-surface-3" />
          </div>
        ) : (
          <div
            role="img"
            aria-label={`${label}: ${message}`}
            style={{ height }}
            className="flex flex-col items-center justify-center gap-0.5 border-b border-border px-4 text-center"
          >
            <span data-slot="event-strip-message" className="text-body-sm text-text-2">
              {message}
            </span>
            {failed && hasText(detail) && (
              <span
                data-slot="event-strip-detail"
                className="text-caption wrap-anywhere text-text-3"
              >
                {detail}
              </span>
            )}
          </div>
        )}
      </figure>
    );
  }

  const placed = /** @type {NonNullable<typeof geo>} */ (geo).placed;
  const xTicks = /** @type {NonNullable<typeof geo>} */ (geo).xTicks;
  const longestName = drawnRows.reduce(
    (a, r) => (String(r.name).length > a.length ? String(r.name) : a),
    ''
  );
  const tipLeft = current != null && current.x <= w / 2;
  const nameStyle = { maxWidth: 160 };

  return (
    <figure
      data-slot="event-strip"
      data-state="ready"
      data-rows={drawnRows.length}
      className={cn(
        'm-0 min-w-0',
        grouped ? 'col-span-full grid grid-cols-subgrid gap-y-2' : 'flex flex-col gap-2',
        className
      )}
      {...props}
    >
      <ul
        data-slot="event-strip-legend"
        aria-hidden="true"
        className={cn(
          'm-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 text-caption text-text-2',
          grouped && 'col-span-full'
        )}
      >
        {usedKinds.map((k) => (
          <li key={k.key} data-kind={k.key} className="flex min-w-0 items-center gap-1.5">
            <ShapeKey shape={k.shape} />
            <span className="wrap-anywhere">{k.word}</span>
          </li>
        ))}
      </ul>
      <div
        data-slot="event-strip-axes"
        className={cn(
          'grid',
          grouped ? 'col-span-full grid-cols-subgrid' : 'grid-cols-[auto_minmax(0,1fr)] gap-x-2'
        )}
      >
        <div
          data-slot="event-strip-names"
          aria-hidden="true"
          className="relative text-caption text-text-2"
          style={{ height: plotH }}
        >
          <span className="invisible block h-0 overflow-hidden whitespace-nowrap" style={nameStyle}>
            {longestName}
          </span>
          {drawnRows.map((r) => (
            <span
              key={r.key}
              data-slot="event-strip-name"
              data-key={r.key}
              className="absolute right-0 block -translate-y-1/2 truncate whitespace-nowrap"
              style={{ top: PAD + r.index * rowHeight + rowHeight / 2, ...nameStyle }}
            >
              {r.name}
            </span>
          ))}
        </div>
        <div
          ref={plotRef}
          data-slot="event-strip-plot"
          role="img"
          tabIndex={0}
          aria-label={label}
          aria-describedby={`${id}-summary`}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true);
            if (active == null && !touched.current) move(last);
          }}
          onBlur={() => {
            touched.current = false;
            setFocused(false);
            setDismissed(false);
            if (!hovering) setActive(null);
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          className="relative min-w-0 touch-pan-y rounded-sm"
          style={{ height: plotH }}
        >
          <svg
            width={w}
            height={plotH}
            viewBox={`0 0 ${w} ${plotH}`}
            aria-hidden="true"
            focusable="false"
            className="block max-w-full overflow-visible"
          >
            {xTicks.map(({ t, x }) => (
              <line
                key={t}
                data-slot="event-strip-grid"
                x1={x}
                x2={x}
                y1="0"
                y2={plotH}
                className="stroke-border-subtle"
                strokeWidth="1"
                shapeRendering="crispEdges"
              />
            ))}
            {drawnRows.map((r) => (
              <line
                key={r.key}
                data-slot="event-strip-baseline"
                x1="0"
                x2={w}
                y1={PAD + r.index * rowHeight + rowHeight}
                y2={PAD + r.index * rowHeight + rowHeight}
                className="stroke-border"
                strokeWidth="1"
                shapeRendering="crispEdges"
              />
            ))}
            {current != null && (
              <line
                data-slot="event-strip-crosshair"
                x1={current.x}
                x2={current.x}
                y1="0"
                y2={plotH}
                className="stroke-border-strong"
                strokeWidth="1"
                shapeRendering="crispEdges"
              />
            )}
            {placed.map((p, i) => {
              const row = drawnRows[p.rowIndex];
              const slot = row.slot;
              const cross = p.kindInfo.shape === 'cross';
              return (
                <g key={p.id}>
                  {open && i === active && (
                    <circle
                      data-slot="event-strip-ring"
                      cx={p.x}
                      cy={p.y}
                      r={RING}
                      className="fill-none stroke-text-1"
                      strokeWidth="2"
                    />
                  )}
                  <path
                    data-slot="event-strip-mark"
                    data-kind={p.kindInfo.key}
                    data-shape={p.kindInfo.shape}
                    data-row={row.key}
                    d={markPath(p.kindInfo.shape, p.x, p.y)}
                    className={cn(
                      cross
                        ? ['fill-none', slot == null ? 'stroke-text-2' : STROKE[slot]]
                        : [slot == null ? 'fill-text-2' : FILL[slot], 'stroke-surface-1']
                    )}
                    strokeWidth={cross ? 2.5 : 1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}
          </svg>
          {current != null && (
            <div
              data-slot="event-strip-tooltip"
              aria-hidden="true"
              className="pointer-events-none absolute top-0 z-dialog flex flex-col gap-0.5 rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-caption whitespace-nowrap text-text-1 shadow-pop"
              style={tipLeft ? { left: current.x + 14 } : { right: w - current.x + 14 }}
            >
              <span className="text-text-2">{formatTime(current.time)}</span>
              <span className="flex items-center gap-1.5">
                <ShapeKey shape={current.kindInfo.shape} />
                <span className="font-bold">{current.kindInfo.word}</span>
                <span className="text-text-2">{current.rowName}</span>
              </span>
              {hasText(current.detail) && <span className="text-text-2">{current.detail}</span>}
            </div>
          )}
        </div>
        {grouped && <div aria-hidden="true" />}
        <div aria-hidden="true" />
        <div
          data-slot="event-strip-x"
          aria-hidden="true"
          className="relative h-4 text-caption text-text-3"
        >
          {xTicks.map(({ t, x, text }) => (
            <span
              key={t}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
              style={{ left: x }}
            >
              {text}
            </span>
          ))}
        </div>
      </div>
      <span id={`${id}-summary`} hidden>
        {summary}
      </span>
      <ul data-slot="event-strip-list" className="sr-only">
        {events.map((e) => (
          <li key={e.id}>{words(e)}</li>
        ))}
      </ul>
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
    </figure>
  );
}

export { EventStrip, ShapeKey };
