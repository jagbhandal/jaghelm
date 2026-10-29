/*
 * AreaChart (#747, monitoring spec §5.4): a filled area of readings over
 * time. Two modes, one chart:
 *
 * - `mirrored`: a diverging area for traffic, two series either side of a
 *   zero line, the first above it (in) and the second below (out), on one
 *   symmetric axis (the same extent up and down, so the two are comparable by
 *   eye). Both series are magnitudes, 0 or more: the chart does the drawing
 *   downwards, and the axis prints each side's tick as its magnitude, in
 *   `formatValue`'s unit (a negative or non-numeric reading is a gap).
 * - plain: one series filled down to the axis' floor (0 for a magnitude).
 *
 * `series` is `[{ key, name, points }]`, `points` as the Chart's (`{ time,
 * value }`, time in ms or a Date, a missing reading null). The first series
 * is chart slot 1 (azure) and the second slot 2, or the slot a series names
 * (0-based `slot`): colour follows the entity, never the accent or a status
 * (docs/design-system.md, "Chart colours"). The fill is a 20 % wash of the
 * slot under a 2px edge of it, so the shape reads at 3:1 and the fill
 * is never what carries the meaning: above or below the zero line, and the
 * name beside the value in the tooltip, say which series is which.
 *
 * A missing reading breaks the area: the shape stops at the last reading and
 * starts again at the next, and is never bridged or dropped to zero, so a
 * node that is off never looks like one that sent nothing. A run of a
 * single reading between two gaps draws no shape (a hover still reads it).
 *
 * Axes and crosshair are the Chart's (chart.jsx): values on the left with a
 * hairline at each tick, times under the plot on the local clock; the
 * nearest time gets a hairline, a ringed dot on each series' edge and a
 * tooltip with both values; by touch a finger down shows it and a sideways
 * drag moves it; and the keyboard reaches it: the plot is an image named by
 * `label` and described by each series' latest, lowest and highest, focus
 * starts at the latest point, the arrows, Home, End and PageUp/Down move,
 * Escape hides it, and a polite live region says each point reached. In a
 * ChartGroup it takes the group's shared columns, so its times line up with
 * the Chart's above and below.
 *
 * `state`: 'ready' draws; 'loading' a placeholder of the plot's height;
 * 'failed' says "No data from Prometheus" (or `failedText`; `detail`: why),
 * never an empty area that looks healthy; no reading at all, "No readings in
 * this range". `busy` dims the plot while the next readings are read.
 */
import { useContext, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from './lib/utils.js';
import { hasText } from './lib/name.js';
import {
  areaPath,
  evenTicks,
  isReading,
  linePath,
  mirroredAxis,
  nearestIndex,
  normalise,
  round2,
  timeTicks,
  valueAxis,
} from './lib/chart.js';
import { ChartGroupContext } from './chart.jsx';
import { dateTimeFormat } from '../util/format.js';

// Each slot's edge, wash, dot and legend key by slot index, written out so Tailwind finds them.
const STROKE = {
  0: 'stroke-series-1',
  1: 'stroke-series-2',
  2: 'stroke-series-3',
  3: 'stroke-series-4',
  4: 'stroke-series-5',
  5: 'stroke-series-6',
};
const FILL = {
  0: 'fill-series-1',
  1: 'fill-series-2',
  2: 'fill-series-3',
  3: 'fill-series-4',
  4: 'fill-series-5',
  5: 'fill-series-6',
};
const WASH = {
  0: 'fill-series-1/20',
  1: 'fill-series-2/20',
  2: 'fill-series-3/20',
  3: 'fill-series-4/20',
  4: 'fill-series-5/20',
  5: 'fill-series-6/20',
};
const SWATCH = {
  0: 'bg-series-1',
  1: 'bg-series-2',
  2: 'bg-series-3',
  3: 'bg-series-4',
  4: 'bg-series-5',
  5: 'bg-series-6',
};

const MINUTE = 60_000;
const HM = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
const defaultTime = (t) => dateTimeFormat(HM).format(new Date(t));
const toMs = (t) => (t instanceof Date ? t.getTime() : t);

// Room in the plot for the ringed dots at its edges.
const INSET = { top: 6, bottom: 4 };

/** A series' key in the legend: a small square of its slot, with its edge. */
function AreaKey({ slot, className }) {
  return (
    <span
      data-slot="area-chart-key"
      aria-hidden="true"
      className={cn('inline-block size-2.5 shrink-0 rounded-xs', SWATCH[slot], className)}
    />
  );
}

function AreaChart({
  label,
  series = [],
  mirrored = false,
  domain = 'zero',
  height = 112,
  formatValue = (v) => String(Math.round(v)),
  formatTime = defaultTime,
  formatTick = defaultTime,
  tickEvery = 15 * MINUTE,
  state = 'ready',
  detail,
  failedText = 'No data from Prometheus',
  busy = false,
  className,
  ...props
}) {
  const id = useId();
  const grouped = useContext(ChartGroupContext);
  const plotRef = useRef(null);
  const [plotWidth, setPlotWidth] = useState(null);
  const [active, setActive] = useState(null);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [said, setSaid] = useState('');
  // A finger (or a pen) is on the plot, or was last: its tap's focus opens nothing.
  const touched = useRef(false);

  const wanted = mirrored ? 2 : 1;
  if (!hasText(label)) {
    const message = 'AreaChart needs a `label`: it has no name';
    if (import.meta.env.DEV) throw new Error(message);
    console.error(message);
  }
  if (state === 'ready' && series.length > wanted) {
    const message = mirrored
      ? 'A mirrored AreaChart draws two series: in above, out below'
      : 'AreaChart draws one series: use the Chart for several';
    if (import.meta.env.DEV) throw new Error(message);
    console.error(message);
  }

  const lines = useMemo(
    () =>
      series.slice(0, wanted).map((s, i) => ({
        key: s.key,
        name: s.name,
        slot: Number.isInteger(s.slot) && s.slot >= 0 && s.slot < 6 ? s.slot : i,
        // A rate below 0 is no reading (a counter reset), so a gap, never a dip.
        data: normalise(s.points).map((p) => ({
          time: toMs(p.time),
          value: isReading(p.value) && p.value >= 0 ? p.value : null,
        })),
      })),
    [series, wanted]
  );
  const count = lines.length;
  const times = useMemo(() => (lines[0]?.data ?? []).map((p) => p.time), [lines]);
  const readings = lines.flatMap((l) => l.data.map((p) => p.value).filter((v) => v != null));
  const drawable = state === 'ready' && readings.length > 0 && times.length > 1;

  // The axis' ticks never print the same label twice: formatValue picks the step.
  const axis = useMemo(() => {
    if (!drawable) return null;
    const format = formatValue;
    if (mirrored) return mirroredAxis(Math.max(...readings), { format });
    if (Array.isArray(domain)) return valueAxis(domain[0], domain[1], { count: 2, format });
    return valueAxis(Math.min(...readings), Math.max(...readings), {
      zero: domain === 'zero',
      format,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readings derive from lines; the formatter is the caller's
  }, [drawable, domain, mirrored, lines]);

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
  const geo = useMemo(() => {
    if (!axis) return null;
    const t0 = times[0];
    const t1 = times.at(-1);
    const span = t1 - t0 || 1;
    const plotH = height - INSET.top - INSET.bottom;
    const xOf = (t, i) =>
      round2((t0 != null && t1 != null ? (t - t0) / span : i / (times.length - 1)) * w);
    const yOf = (v) => {
      const c = Math.min(Math.max(v, axis.lo), axis.hi);
      return round2(INSET.top + (1 - (c - axis.lo) / (axis.hi - axis.lo)) * plotH);
    };
    // The shape closes on zero, or on the floor when the axis starts above it.
    const base = yOf(Math.min(Math.max(0, axis.lo), axis.hi));
    const xs = times.map((t, i) => xOf(t, i));
    const drawn = lines.map((l, n) => {
      // In a mirrored chart the second series is drawn below the zero line.
      const sign = mirrored && n === 1 ? -1 : 1;
      const xy = l.data.map((p, i) => ({
        x: xs[i],
        y: p.value == null ? null : yOf(sign * p.value),
      }));
      const { line, runs } = linePath(xy);
      return { ...l, xy, path: line, area: areaPath(runs, base) };
    });
    const ticks = axis.ticks.map((v) => ({ v, y: yOf(v) }));
    const xTicks =
      t0 != null && t1 != null
        ? evenTicks(
            timeTicks(t0, t1, tickEvery).map((t) => ({ t, x: xOf(t) })),
            { width: w, every: tickEvery, span: t1 - t0, labelOf: formatTick }
          )
        : [];
    return { xs, drawn, ticks, xTicks, base };
  }, [axis, times, lines, w, height, tickEvery, formatTick, mirrored]);

  const last = times.length - 1;
  const open = geo != null && active != null && !dismissed && (hovering || focused);

  const valueText = (v) => (v == null ? 'no reading' : formatValue(v));
  const pointWords = (i) => {
    const at = formatTime(times[i]);
    if (count === 1) return `${valueText(lines[0].data[i]?.value ?? null)} at ${at}`;
    return `${at}: ${lines.map((l) => `${l.name} ${valueText(l.data[i]?.value ?? null)}`).join(', ')}`;
  };
  const summary = useMemo(() => {
    if (!geo) return '';
    const parts = lines.map((l, n) => {
      const values = l.data.map((p) => p.value).filter((v) => v != null);
      const who =
        count > 1
          ? `${l.name}${mirrored ? (n === 0 ? ' (above zero)' : ' (below zero)') : ''}: `
          : '';
      if (!values.length) return `${who}no readings.`;
      const latest = [...l.data].reverse().find((p) => p.value != null);
      return `${who}latest ${formatValue(latest.value)} at ${formatTime(latest.time)}, lowest ${formatValue(Math.min(...values))}, highest ${formatValue(Math.max(...values))}.`;
    });
    return `${parts.join(' ')} The arrow keys read each point.`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the formatters are the caller's
  }, [geo, lines, count, mirrored]);

  const move = (i) => {
    setActive(i);
    setDismissed(false);
  };

  const onPointerMove = (e) => {
    if (!geo) return;
    const box = plotRef.current?.getBoundingClientRect();
    if (!box?.width) return;
    const nearest = nearestIndex(geo.xs, ((e.clientX - box.left) / box.width) * w);
    setHovering(true);
    if (nearest !== active) move(nearest);
  };
  const onPointerLeave = () => {
    setHovering(false);
    if (!focused) setActive(null);
  };
  // Touch: down shows the finger's time, a drag follows it, up hides it.
  const onPointerDown = (e) => {
    touched.current = e.pointerType !== 'mouse';
    if (!touched.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onPointerMove(e);
  };
  const onPointerUp = (e) => {
    if (e.pointerType === 'mouse') return;
    setHovering(false);
    setActive(null);
  };

  const KEYS = {
    ArrowLeft: (i) => Math.max(i - 1, 0),
    ArrowDown: (i) => Math.max(i - 1, 0),
    ArrowRight: (i) => Math.min(i + 1, last),
    ArrowUp: (i) => Math.min(i + 1, last),
    PageDown: (i) => Math.max(i - 10, 0),
    PageUp: (i) => Math.min(i + 10, last),
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
    if (!to || !geo) return;
    e.preventDefault();
    const next = to(active ?? last);
    move(next);
    setSaid(pointWords(next));
  };

  // ── Not drawn: loading, failed, nothing in range ──
  if (!drawable) {
    const loading = state === 'loading';
    const failed = state === 'failed';
    const words = failed ? failedText : 'No readings in this range';
    return (
      <figure
        data-slot="area-chart"
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
            aria-label={`${label}: ${words}`}
            style={{ height }}
            className="flex flex-col items-center justify-center gap-0.5 border-b border-border px-4 text-center"
          >
            <span data-slot="area-chart-message" className="text-body-sm text-text-2">
              {words}
            </span>
            {failed && hasText(detail) && (
              <span
                data-slot="area-chart-detail"
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

  const point = open ? active : null;
  const pointX = point == null ? null : geo.xs[point];
  const tipLeft = pointX != null && pointX <= w / 2;
  // A tick prints its magnitude: below the zero line is still "2 MB/s".
  const tickText = (v) => formatValue(Math.abs(v));
  const longestTick = geo.ticks.reduce(
    (a, t) => (tickText(t.v).length > a.length ? tickText(t.v) : a),
    ''
  );

  return (
    <figure
      data-slot="area-chart"
      data-state="ready"
      data-mode={mirrored ? 'mirrored' : 'area'}
      aria-busy={busy || undefined}
      className={cn(
        'm-0 min-w-0',
        grouped ? 'col-span-full grid grid-cols-subgrid gap-y-2' : 'flex flex-col gap-2',
        className
      )}
      {...props}
    >
      {count > 1 && (
        <ul
          data-slot="area-chart-legend"
          aria-hidden="true"
          className={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-2',
            grouped && 'col-span-full'
          )}
        >
          {lines.map((l, n) => (
            <li key={l.key} data-key={l.key} className="flex min-w-0 items-center gap-1.5">
              <AreaKey slot={l.slot} />
              <span className="wrap-anywhere">{l.name}</span>
              {mirrored && <span className="text-text-3">{n === 0 ? 'above' : 'below'}</span>}
            </li>
          ))}
        </ul>
      )}
      <div
        data-slot="area-chart-axes"
        className={cn(
          'grid transition-opacity',
          grouped ? 'col-span-full grid-cols-subgrid' : 'grid-cols-[auto_minmax(0,1fr)] gap-x-2',
          busy && 'opacity-60'
        )}
      >
        <div
          data-slot="area-chart-y"
          aria-hidden="true"
          className="relative text-caption text-text-3"
        >
          <span className="invisible block h-0 overflow-hidden whitespace-nowrap">
            {longestTick}
          </span>
          {geo.ticks.map((t) => (
            <span
              key={t.v}
              className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
              style={{ top: t.y }}
            >
              {tickText(t.v)}
            </span>
          ))}
        </div>
        <div
          ref={plotRef}
          data-slot="area-chart-plot"
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
          style={{ height }}
        >
          <svg
            width={w}
            height={height}
            viewBox={`0 0 ${w} ${height}`}
            aria-hidden="true"
            focusable="false"
            className="block max-w-full overflow-visible"
          >
            {geo.ticks.map((t) => (
              <line
                key={t.v}
                data-slot="area-chart-grid"
                x1="0"
                x2={w}
                y1={t.y}
                y2={t.y}
                className={t.y === geo.base ? 'stroke-border' : 'stroke-border-subtle'}
                strokeWidth="1"
                shapeRendering="crispEdges"
              />
            ))}
            {geo.drawn.map((l) => (
              <g key={l.key} data-slot="area-chart-series" data-key={l.key}>
                <path data-slot="area-chart-area" d={l.area} className={WASH[l.slot]} />
                <path
                  data-slot="area-chart-line"
                  d={l.path}
                  className={cn('fill-none', STROKE[l.slot])}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            ))}
            {point != null && (
              <g data-slot="area-chart-crosshair">
                <line
                  x1={pointX}
                  x2={pointX}
                  y1="0"
                  y2={height}
                  className="stroke-border-strong"
                  strokeWidth="1"
                  shapeRendering="crispEdges"
                />
                {geo.drawn.map((l) =>
                  l.xy[point]?.y == null ? null : (
                    <circle
                      key={l.key}
                      data-slot="area-chart-dot"
                      cx={pointX}
                      cy={l.xy[point].y}
                      r="4"
                      className={cn(FILL[l.slot], 'stroke-surface-1')}
                      strokeWidth="2"
                    />
                  )
                )}
              </g>
            )}
          </svg>
          {point != null && (
            <div
              data-slot="area-chart-tooltip"
              aria-hidden="true"
              className="pointer-events-none absolute top-0 z-dialog flex flex-col gap-0.5 rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-caption whitespace-nowrap text-text-1 shadow-pop"
              style={tipLeft ? { left: pointX + 10 } : { right: w - pointX + 10 }}
            >
              <span className="text-text-2">{formatTime(times[point])}</span>
              {lines.map((l) => {
                const v = l.data[point]?.value ?? null;
                return (
                  <span key={l.key} className="flex items-center gap-1.5">
                    {count > 1 && <AreaKey slot={l.slot} />}
                    <span className={v == null ? 'text-text-2' : 'font-bold'}>
                      {v == null ? 'No data' : formatValue(v)}
                    </span>
                    {count > 1 && <span className="text-text-2">{l.name}</span>}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        {grouped && <div aria-hidden="true" />}
        <div aria-hidden="true" />
        <div
          data-slot="area-chart-x"
          aria-hidden="true"
          className="relative h-4 text-caption text-text-3"
        >
          {geo.xTicks.map(({ t, x, text }) => (
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
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
    </figure>
  );
}

export { AreaChart, AreaKey };
