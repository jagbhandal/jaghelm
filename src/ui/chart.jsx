/*
 * Chart (spec §5.4, §8; #311): a line chart of readings over time, the
 * detail drawer's history (a node's CPU, memory, disk and temperature, the
 * CPU and memory of containers, over 1 h, 24 h or 7 d). Its sparkline variant,
 * for a card or a row, is the Sparkline (sparkline.jsx); both draw from one
 * geometry (lib/chart.js).
 *
 * `series` are the lines, `[{ key, name, points }]`, in chart-slot order:
 * the first is slot 1 (azure), and so on to six (docs/design-system.md,
 * "Chart colours"). A caller gives each entity the same place on every chart,
 * so its colour follows it; a series never means a state, and the chart never
 * draws the accent or a status colour. Every series has a point per time, in
 * the same order, `{ time, value }` (time in ms or a Date), a missing reading
 * as null, which breaks its line, never bridged. More than six is refused:
 * fold the rest into one series first.
 *
 * - One series: no legend; the chart's title (`label`, and the heading the
 *   caller puts over it) says what it is.
 * - Two or more: a legend over the plot, and each line's name at its right
 *   end (moved apart where lines end close together, with a leader back to
 *   its line), words in text-2 beside a key of the line, never in its colour.
 * - More than three: slots 4 to 6 are drawn dashed, each its own pattern
 *   (long dashes, dots, dash and dot), in the plot, the legend and the
 *   tooltip, because in a line chart any two lines can cross, and three
 *   pairs of the six slots nearly merge for red-green colour blindness (Jag,
 *   #311). Three or fewer are solid.
 *
 * Axes: values on the left at `domain` (`[lo, hi]`, 0–100 for a percentage),
 * or fitted to the readings (`'auto'`, a temperature) or from 0 (`'zero'`, a
 * magnitude: memory, the CPU of containers), with a hairline at each tick; times
 * under the plot on the local clock (`formatTick`): every `tickEvery` ms, or
 * every second, third… of those, evenly, as the plot's width allows, each
 * centred on its tick. In a ChartGroup the charts share one time axis: the
 * same plot left edge and width, so the same range draws the same ticks.
 * Values are printed by `formatValue` (with their unit), times in the
 * tooltip by `formatTime`.
 *
 * The crosshair: the pointer's nearest time gets a hairline, a ringed dot on
 * each line, and a tooltip listing every series' value there (the value
 * strong, its name after it). By touch (#602) a finger down on the plot shows
 * it at the finger, a sideways drag moves it, and lifting the finger hides
 * it; an up-and-down drag still scrolls the page, and the focus a tap leaves
 * on the plot opens nothing. The keyboard reaches it too: the plot is an
 * image named by `label` and described by each series' latest, lowest and
 * highest, so nothing lives only in the tooltip; focus starts at the latest
 * point, the arrows, Home and End move, Escape hides it, and a polite live
 * region says each point the arrows reach.
 *
 * `state`: 'ready' draws the lines; 'loading' a placeholder of the plot's
 * height; 'failed' says "No data from Prometheus" (or `failedText`, when
 * the read itself failed; `detail`: why), never an empty line that looks
 * healthy; with no reading at all, "No readings in
 * this range". `busy` keeps the last lines at reduced opacity while the next
 * are read, so a range switch doesn't flash.
 */
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from './lib/utils.js';
import { hasText } from './lib/name.js';
import {
  evenTicks,
  linePath,
  normalise,
  round2,
  spreadLabels,
  timeTicks,
  valueAxis,
} from './lib/chart.js';

/** Each slot's line and dot, by slot index, written out so Tailwind finds them. */
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

/** Slots 4 to 6's dashes, drawn only in a chart of more than three series (round caps). */
export const SLOT_DASHES = Object.freeze([null, null, null, '6 6', '0.5 5', '10 5 0.5 5']);
export const MAX_SERIES = 6;

const PERCENT = Object.freeze([0, 100]);
const MINUTE = 60_000;
const HM = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const defaultTime = (t) => HM.format(new Date(t));
const toMs = (t) => (t instanceof Date ? t.getTime() : t);

// Room in the plot for the ringed dots at its edges.
const INSET = { top: 6, bottom: 4 };
const LABEL_GAP = 16;

// Inside a ChartGroup, a chart lays its value labels, plot and line names
// into the group's three shared columns (a subgrid), so stacked charts share
// a plot's left edge and width: one time axis.
const ChartGroupContext = createContext(false);

/**
 * Charts stacked on one time axis (#311): a grid whose three columns (the
 * value labels, the plot, the line names) every Chart and other child in it
 * takes as a subgrid (`col-span-full grid grid-cols-subgrid`), so the widest
 * value label and the widest name set the columns for all of them, and every
 * plot starts at the same x and is as wide: the same times line up, and the
 * same range draws the same ticks. DetailCharts holds its charts in one.
 */
function ChartGroup({ className, children, ...props }) {
  return (
    <div
      data-slot="chart-group"
      className={cn('grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2', className)}
      {...props}
    >
      <ChartGroupContext.Provider value>{children}</ChartGroupContext.Provider>
    </div>
  );
}

/** Whether slot `i` (0-based) is dashed in a chart of `n` series. */
const dashOf = (i, n) => (n > 3 ? SLOT_DASHES[i] : null);

/** A short key of slot `i`'s line, as the legend, the labels and the tooltip show it. */
function LineKey({ slot, count, className }) {
  return (
    <svg
      data-slot="chart-key"
      width="20"
      height="8"
      viewBox="0 0 20 8"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0 overflow-visible', className)}
    >
      <line
        x1="1"
        y1="4"
        x2="19"
        y2="4"
        className={STROKE[slot]}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={dashOf(slot, count) ?? undefined}
      />
    </svg>
  );
}

function Chart({
  label,
  series = [],
  domain = PERCENT,
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

  if (!hasText(label)) {
    const message = 'Chart needs a `label`: it has no name';
    if (import.meta.env.DEV) throw new Error(message);
    console.error(message);
  }
  if (series.length > MAX_SERIES) {
    const message = `Chart draws at most ${MAX_SERIES} series: fold the rest into one`;
    if (import.meta.env.DEV) throw new Error(message);
    console.error(message);
  }

  const lines = useMemo(
    () =>
      series.slice(0, MAX_SERIES).map((s, slot) => ({
        key: s.key,
        name: s.name,
        slot,
        data: normalise(s.points).map((p) => ({ ...p, time: toMs(p.time) })),
      })),
    [series]
  );
  const count = lines.length;
  const times = useMemo(() => (lines[0]?.data ?? []).map((p) => p.time), [lines]);
  const readings = lines.flatMap((l) => l.data.map((p) => p.value).filter((v) => v != null));
  const drawable = state === 'ready' && readings.length > 0 && times.length > 1;

  const axis = useMemo(() => {
    if (!drawable) return null;
    if (Array.isArray(domain)) return valueAxis(domain[0], domain[1], { count: 2 });
    return valueAxis(Math.min(...readings), Math.max(...readings), { zero: domain === 'zero' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readings derive from lines
  }, [drawable, domain, lines]);

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
    const xs = times.map((t, i) => xOf(t, i));
    const drawn = lines.map((l) => {
      const xy = l.data.map((p, i) => ({ x: xs[i], y: p.value == null ? null : yOf(p.value) }));
      const last = [...xy].reverse().find((p) => p.y != null) ?? null;
      return { ...l, xy, path: linePath(xy).line, last };
    });
    const ticks = axis.ticks.map((v) => ({ v, y: yOf(v) }));
    const xTicks =
      t0 != null && t1 != null
        ? evenTicks(
            timeTicks(t0, t1, tickEvery).map((t) => ({ t, x: xOf(t) })),
            { width: w, every: tickEvery, span: t1 - t0, labelOf: formatTick }
          )
        : [];
    const ends =
      count > 1
        ? spreadLabels(
            drawn.filter((l) => l.last).map((l) => ({ key: l.key, y: l.last.y })),
            { gap: LABEL_GAP, top: LABEL_GAP / 2, bottom: height - LABEL_GAP / 2 }
          )
        : {};
    return { xs, drawn, ticks, xTicks, ends };
  }, [axis, times, lines, w, height, tickEvery, formatTick, count]);

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
    const parts = lines.map((l) => {
      const values = l.data.map((p) => p.value).filter((v) => v != null);
      if (!values.length) return `${count > 1 ? `${l.name}: ` : ''}no readings.`;
      const latest = [...l.data].reverse().find((p) => p.value != null);
      const who = count > 1 ? `${l.name}: ` : '';
      return `${who}latest ${formatValue(latest.value)} at ${formatTime(latest.time)}, lowest ${formatValue(Math.min(...values))}, highest ${formatValue(Math.max(...values))}.`;
    });
    return `${parts.join(' ')} The arrow keys read each point.`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the formatters are the caller's
  }, [geo, lines, count]);

  const move = (i) => {
    setActive(i);
    setDismissed(false);
  };

  const onPointerMove = (e) => {
    if (!geo) return;
    const box = plotRef.current?.getBoundingClientRect();
    if (!box?.width) return;
    const x = ((e.clientX - box.left) / box.width) * w;
    let nearest = 0;
    geo.xs.forEach((px, i) => {
      if (Math.abs(px - x) < Math.abs(geo.xs[nearest] - x)) nearest = i;
    });
    setHovering(true);
    if (nearest !== active) move(nearest);
  };
  const onPointerLeave = () => {
    setHovering(false);
    if (!focused) setActive(null);
  };
  // Touch (#602): down shows the finger's time, a drag follows it (the plot
  // keeps the finger past its edges), and up or a scroll taking over hides it.
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
        data-slot="chart"
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
            <span data-slot="chart-message" className="text-body-sm text-text-2">
              {words}
            </span>
            {failed && hasText(detail) && (
              <span data-slot="chart-detail" className="text-caption wrap-anywhere text-text-3">
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
  const longestTick = geo.ticks.reduce(
    (a, t) => (formatValue(t.v).length > a.length ? formatValue(t.v) : a),
    ''
  );
  const labelled = geo.drawn.filter((l) => l.last && count > 1);
  const longestName = labelled.reduce(
    (a, l) => (String(l.name).length > a.length ? String(l.name) : a),
    ''
  );

  return (
    <figure
      data-slot="chart"
      data-state="ready"
      data-series={count}
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
          data-slot="chart-legend"
          aria-hidden="true"
          className={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-2',
            grouped && 'col-span-full'
          )}
        >
          {lines.map((l) => (
            <li key={l.key} data-key={l.key} className="flex min-w-0 items-center gap-1.5">
              <LineKey slot={l.slot} count={count} />
              <span className="wrap-anywhere">{l.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div
        data-slot="chart-axes"
        className={cn(
          'grid transition-opacity',
          grouped
            ? 'col-span-full grid-cols-subgrid'
            : labelled.length
              ? 'grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2'
              : 'grid-cols-[auto_minmax(0,1fr)] gap-x-2',
          busy && 'opacity-60'
        )}
      >
        <div data-slot="chart-y" aria-hidden="true" className="relative text-caption text-text-3">
          <span className="invisible block h-0 overflow-hidden whitespace-nowrap">
            {longestTick}
          </span>
          {geo.ticks.map((t) => (
            <span
              key={t.v}
              className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
              style={{ top: t.y }}
            >
              {formatValue(t.v)}
            </span>
          ))}
        </div>
        <div
          ref={plotRef}
          data-slot="chart-plot"
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
            {geo.ticks.map((t, i) => (
              <line
                key={t.v}
                data-slot="chart-grid"
                x1="0"
                x2={w}
                y1={t.y}
                y2={t.y}
                className={i === 0 ? 'stroke-border' : 'stroke-border-subtle'}
                strokeWidth="1"
                shapeRendering="crispEdges"
              />
            ))}
            {geo.drawn.map((l) => (
              <path
                key={l.key}
                data-slot="chart-line"
                data-key={l.key}
                d={l.path}
                className={cn('fill-none', STROKE[l.slot])}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={dashOf(l.slot, count) ?? undefined}
              />
            ))}
            {labelled.map((l) => {
              const y = geo.ends[l.key];
              if (y == null || Math.abs(y - l.last.y) <= 2) return null;
              return (
                <line
                  key={l.key}
                  data-slot="chart-leader"
                  x1={l.last.x}
                  y1={l.last.y}
                  x2={w + 7}
                  y2={y}
                  className="stroke-border-strong"
                  strokeWidth="1"
                />
              );
            })}
            {point != null && (
              <g data-slot="chart-crosshair">
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
                      data-slot="chart-dot"
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
              data-slot="chart-tooltip"
              aria-hidden="true"
              className="pointer-events-none absolute top-0 z-dialog flex flex-col gap-0.5 rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-caption whitespace-nowrap text-text-1 shadow-pop"
              style={tipLeft ? { left: pointX + 10 } : { right: w - pointX + 10 }}
            >
              <span className="text-text-2">{formatTime(times[point])}</span>
              {lines.map((l) => {
                const v = l.data[point]?.value ?? null;
                return (
                  <span key={l.key} className="flex items-center gap-1.5">
                    {count > 1 && <LineKey slot={l.slot} count={count} />}
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
        {labelled.length === 0 && grouped && <div aria-hidden="true" />}
        {labelled.length > 0 && (
          <div
            data-slot="chart-labels"
            aria-hidden="true"
            className="relative text-caption text-text-2"
            style={{ height }}
          >
            <span className="invisible flex h-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
              <LineKey slot={0} count={1} />
              {longestName}
            </span>
            {labelled.map((l) => (
              <span
                key={l.key}
                data-slot="chart-label"
                data-key={l.key}
                className="absolute left-0 flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap"
                style={{ top: geo.ends[l.key] }}
              >
                <LineKey slot={l.slot} count={count} />
                {l.name}
              </span>
            ))}
          </div>
        )}
        <div aria-hidden="true" />
        <div
          data-slot="chart-x"
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

export { Chart, ChartGroup, LineKey };
