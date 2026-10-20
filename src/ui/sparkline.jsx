/*
 * Sparkline (spec §5.4, §8; #288): one reading's recent trend, such as a
 * node's CPU over the last hour, small enough for a card or a row.
 *
 * One series, always chart slot 1 (`series-1`, azure): a chart that draws one
 * series by design takes slot 1, and a series never means a state
 * (docs/design-system.md, "Chart colours"). It never draws the accent or a
 * status colour, and never sits on `surface-3`. Because it is always slot 1,
 * a meter beside it never meets the teal or plum slots that sit close to the
 * Cyan and Fuchsia meters.
 *
 * The plain line is the mock's node card (96 × 24, a 1.5px line); `area` is
 * the Charts board's (a 2px line over a 14 % fill, the latest reading as a
 * dot ringed in the panel's colour). Readings are drawn against `domain`,
 * 0–100 by default, so a flat line at 90 % reads differently from one at 10 %;
 * `domain="auto"` uses the readings' own range (latency). A missing reading
 * (null) breaks the line. Fewer than two readings draw nothing.
 *
 * `points` are numbers, or `{ time, value }` (time in ms or a Date). A tooltip
 * gives the value and time of the point nearest the pointer, or of the point
 * the keyboard is on: focus starts at the latest, the arrows, Home and End
 * move, Escape closes it. A polite live region says each point the arrows
 * reach. It is an image named by `label` and described by its latest, lowest
 * and highest readings, so nothing lives only in the tooltip (which never
 * opens on touch); without a `label` it throws in development and logs in
 * production. `decorative` hides it from assistive tech and the tab
 * order, for a sparkline inside something that opens (a node card, a row):
 * that one's name says what matters, and the pointer still gets the tooltip.
 */
import { useId, useMemo, useRef, useState } from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cn } from './lib/utils.js';
import { useOverlayPortal } from './lib/portal.js';
import { hasText } from './lib/name.js';

// The Charts board's insets for the area and its dot; the plain line keeps
// clear of the box by its own half width, as the mock's.
const INSETS = {
  line: { x: 1, top: 1, bottom: 1 },
  area: { x: 4, top: 4, bottom: 2 },
};

const isReading = (v) => typeof v === 'number' && Number.isFinite(v);
const PERCENT = Object.freeze([0, 100]);
const round = (n) => Math.round(n * 100) / 100;

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const defaultTime = (t) => TIME.format(t instanceof Date ? t : new Date(t));

/** `points` as `{ time, value }`, a missing or non-numeric value as null. */
function normalise(points) {
  return (points ?? []).map((p) =>
    p != null && typeof p === 'object' && !(p instanceof Date)
      ? { time: p.time ?? null, value: isReading(p.value) ? p.value : null }
      : { time: null, value: isReading(p) ? p : null }
  );
}

/** The SVG geometry: each point's x and y, and the line's and area's paths. */
function geometry(data, { width, height, domain, inset }) {
  const values = data.map((d) => d.value).filter(isReading);
  let [lo, hi] = domain === 'auto' ? [Math.min(...values), Math.max(...values)] : domain;
  const flat = hi === lo;
  if (flat) [lo, hi] = [lo - 1, hi + 1];
  const plotW = width - inset.x * 2;
  const plotH = height - inset.top - inset.bottom;
  const n = data.length;
  const xy = data.map((d, i) => {
    const x = round(inset.x + (i / (n - 1)) * plotW);
    if (d.value == null) return { x, y: null };
    const v = Math.min(Math.max(d.value, lo), hi);
    return { x, y: round(inset.top + (1 - (v - lo) / (hi - lo)) * plotH) };
  });
  // Runs of readings between the gaps.
  const runs = [];
  let run = [];
  for (const p of xy) {
    if (p.y == null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length) runs.push(run);
  const drawn = runs.filter((r) => r.length > 1);
  const line = drawn.map((r) => r.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('')).join('');
  const base = height - inset.bottom;
  const area = drawn
    .map(
      (r) => `M${r[0].x} ${base}${r.map((p) => `L${p.x} ${p.y}`).join('')}L${r.at(-1).x} ${base}Z`
    )
    .join('');
  return { xy, line, area };
}

function Sparkline({
  label,
  points,
  domain = PERCENT,
  width = 96,
  height = 24,
  area = false,
  unit = '',
  formatValue,
  formatTime = defaultTime,
  decorative = false,
  className,
  ...props
}) {
  const id = useId();
  const rootRef = useRef(null);
  const svgRef = useRef(null);
  const [active, setActive] = useState(null);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [said, setSaid] = useState('');

  const data = useMemo(() => normalise(points), [points]);
  const readings = data.filter((d) => d.value != null);
  const inset = INSETS[area ? 'area' : 'line'];
  const geo = useMemo(
    () => (readings.length < 2 ? null : geometry(data, { width, height, domain, inset })),
    [data, readings.length, width, height, domain, inset]
  );

  const open = active != null && !dismissed && (hovering || focused);
  const [portalRoot, openChange] = useOverlayPortal(rootRef, open, (next) => {
    if (!next) setDismissed(true);
  });

  if (!decorative && !hasText(label)) {
    const message = 'Sparkline needs a `label`, or `decorative`: it has no name';
    if (import.meta.env.DEV) throw new Error(message);
    console.error(message);
  }
  if (!geo) return null;

  const value = (v) => (formatValue ? formatValue(v) : `${Math.round(v)}${unit}`);
  const time = (t) => (t == null ? null : formatTime(t));
  const words = (d) =>
    d.value == null ? 'No data' : [value(d.value), time(d.time)].filter(Boolean).join(' at ');

  const last = data.length - 1;
  const latest = [...data].reverse().find((d) => d.value != null);
  const low = Math.min(...readings.map((d) => d.value));
  const high = Math.max(...readings.map((d) => d.value));
  const summary = `Latest ${words(latest)}. Lowest ${value(low)}, highest ${value(high)}. The arrow keys read each point.`;

  const move = (i) => {
    setActive(i);
    setDismissed(false);
  };

  const onPointerMove = (e) => {
    if (e.pointerType === 'touch') return;
    const box = svgRef.current?.getBoundingClientRect();
    if (!box?.width) return;
    const x = ((e.clientX - box.left) / box.width) * width;
    let nearest = 0;
    geo.xy.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(geo.xy[nearest].x - x)) nearest = i;
    });
    setHovering(true);
    if (nearest !== active) move(nearest);
  };

  const onPointerLeave = () => {
    setHovering(false);
    if (!focused) setActive(null);
  };

  const KEYS = {
    ArrowLeft: (i) => Math.max(i - 1, 0),
    ArrowDown: (i) => Math.max(i - 1, 0),
    ArrowRight: (i) => Math.min(i + 1, last),
    ArrowUp: (i) => Math.min(i + 1, last),
    Home: () => 0,
    End: () => last,
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setDismissed(true);
      }
      return;
    }
    const to = KEYS[e.key];
    if (!to) return;
    e.preventDefault();
    const next = to(active ?? last);
    move(next);
    setSaid(words(data[next]));
  };

  const point = active == null ? null : geo.xy[active];
  // Above the chart, over the point: the tooltip never covers the line, and
  // clears the focus ring.
  const anchor = {
    getBoundingClientRect() {
      const box = svgRef.current?.getBoundingClientRect() ?? new DOMRect();
      const x = box.left + ((point?.x ?? width) * box.width) / width;
      return new DOMRect(x, box.top, 0, 0);
    },
  };
  const tip = active == null ? null : data[active];

  const focusable = decorative
    ? {}
    : {
        role: 'img',
        tabIndex: 0,
        'aria-label': label,
        'aria-describedby': `${id}-summary`,
        onKeyDown,
        onFocus: () => {
          setFocused(true);
          if (active == null) move(last);
        },
        onBlur: () => {
          setFocused(false);
          setDismissed(false);
          if (!hovering) setActive(null);
        },
      };

  return (
    <span
      ref={rootRef}
      data-slot="sparkline"
      aria-hidden={decorative || undefined}
      className={cn('relative inline-block align-middle', className)}
      {...props}
    >
      <span
        data-slot="sparkline-chart"
        className="block rounded-sm"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        {...focusable}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          aria-hidden="true"
          focusable="false"
          className="block h-auto w-full overflow-visible"
        >
          {area && geo.area && (
            <path data-slot="sparkline-area" d={geo.area} className="fill-series-1/14" />
          )}
          <path
            data-slot="sparkline-line"
            d={geo.line}
            className="fill-none stroke-series-1"
            strokeWidth={area ? 2 : 1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {area && geo.xy[last].y != null && (
            <circle
              data-slot="sparkline-end"
              cx={geo.xy[last].x}
              cy={geo.xy[last].y}
              r={3.5}
              className="fill-series-1 stroke-surface-1"
              strokeWidth={2}
            />
          )}
          {open && point?.y != null && (
            <circle
              data-slot="sparkline-active"
              cx={point.x}
              cy={point.y}
              r={area ? 3.5 : 3}
              className="fill-series-1 stroke-surface-1"
              strokeWidth={2}
            />
          )}
        </svg>
      </span>
      {!decorative && (
        <>
          <span id={`${id}-summary`} hidden>
            {summary}
          </span>
          <span className="sr-only" aria-live="polite">
            {said}
          </span>
        </>
      )}
      <TooltipPrimitive.Root open={open} onOpenChange={openChange}>
        <TooltipPrimitive.Portal {...portalRoot}>
          <TooltipPrimitive.Positioner
            anchor={anchor}
            side="top"
            sideOffset={8}
            collisionPadding={8}
            className="pointer-events-none z-dialog"
          >
            <TooltipPrimitive.Popup
              data-slot="sparkline-tooltip"
              className="flex items-baseline gap-2 rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-caption whitespace-nowrap text-text-1 shadow-pop"
            >
              {tip &&
                (tip.value == null ? (
                  <span className="text-text-2">No data</span>
                ) : (
                  <>
                    <span className="font-bold">{value(tip.value)}</span>
                    {tip.time != null && <span className="text-text-2">{time(tip.time)}</span>}
                  </>
                ))}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </span>
  );
}

export { Sparkline };
