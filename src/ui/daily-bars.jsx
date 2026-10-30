/*
 * DailyBars (Monitoring spec §5, chart 2; #748): one vertical bar a day, such
 * as what the lab cost to run each day. Slot 1, azure, the one series
 * (docs/design-system.md, "Chart colours"): a bar never takes a status colour,
 * and the accent never draws in a plot.
 *
 * `days` are `{ key, time, value, note }`, oldest first: `time` a local
 * midnight (ms or a Date), `value` the day's total (null: no data, no bar),
 * `note` an extra line the caller wants in that day's tooltip, such as the
 * rate in force that day. The bars start at 0 (a magnitude), on a value axis
 * stepped so `formatValue` prints no two ticks alike.
 *
 * `partial` marks the last day as not over: its bar is drawn lighter (a 40 %
 * fill with a dashed slot-1 outline, which keeps the 3:1 a graphic needs) and
 * its tooltip, the readings and the line under the plot all say `partialWord`
 * ("so far") after its value, so the shortfall is never read as a cheap day.
 *
 * The pointer's day (never a finger's) gets a hairline and a tooltip: the day,
 * its value in bold, the note. The keyboard reaches it too: the plot is an
 * image named by `label` and described by its latest, lowest and highest day,
 * so nothing lives only in the tooltip; focus starts at the latest day, the
 * arrows, Home and End move, Escape hides the tooltip, and a polite live
 * region says each day the arrows reach.
 *
 * `state`: 'ready' draws the bars; 'loading' a placeholder of the plot's
 * height; 'failed' says "No data from Prometheus" (or `failedText`; `detail`:
 * why); with no day at all, `emptyText`.
 */
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from './lib/utils.js';
import { hasText } from './lib/name.js';
import { isReading, round2, valueAxis } from './lib/chart.js';
import { dateTimeFormat } from '../util/format.js';

const SHORT = { weekday: 'short', day: 'numeric' };
const LONG = { weekday: 'short', day: 'numeric', month: 'short' };
const toDate = (t) => (t instanceof Date ? t : new Date(t));
const defaultTick = (t) => dateTimeFormat(SHORT).format(toDate(t));
const defaultDay = (t) => dateTimeFormat(LONG).format(toDate(t));

const INSET = { top: 6, bottom: 1 };
const FALLBACK_WIDTH = 400;
const MAX_BAR = 28;

const KEYS = {
  ArrowLeft: (i) => Math.max(i - 1, 0),
  ArrowDown: (i) => Math.max(i - 1, 0),
  ArrowRight: (i, last) => Math.min(i + 1, last),
  ArrowUp: (i, last) => Math.min(i + 1, last),
  Home: () => 0,
  End: (i, last) => last,
};

function DailyBars({
  label,
  days = [],
  partial = false,
  partialWord = 'so far',
  formatValue = (v) => String(Math.round(v)),
  formatTick = defaultTick,
  formatDay = defaultDay,
  height = 112,
  state = 'ready',
  detail,
  failedText = 'No data from Prometheus',
  emptyText = 'No days in this range',
  className,
  ...props
}) {
  const id = useId();
  const plotRef = useRef(null);
  const [plotWidth, setPlotWidth] = useState(null);
  const [active, setActive] = useState(null);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [said, setSaid] = useState('');

  if (!hasText(label)) {
    const message = 'DailyBars needs a `label`: it has no name';
    if (import.meta.env.DEV) throw new Error(message);
    console.error(message);
  }

  const data = useMemo(
    () => days.map((d) => ({ ...d, value: isReading(d.value) ? d.value : null })),
    [days]
  );
  const n = data.length;
  const last = n - 1;
  const readings = data.map((d) => d.value).filter((v) => v != null);
  const drawable = state === 'ready' && n > 0;

  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return undefined;
    const measure = () => {
      const measured = Math.round(el.getBoundingClientRect().width * 100) / 100;
      setPlotWidth(measured > 0 ? measured : null);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [drawable]);

  const axis = useMemo(
    () =>
      drawable
        ? valueAxis(0, readings.length ? Math.max(...readings) : 0, {
            zero: true,
            format: formatValue,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readings follows data
    [drawable, data, formatValue]
  );

  if (!drawable) {
    const loading = state === 'loading';
    const failed = state === 'failed';
    const words = failed ? failedText : emptyText;
    return (
      <figure
        data-slot="daily-bars"
        data-state={loading ? 'loading' : failed ? 'failed' : 'empty'}
        className={cn('m-0 flex min-w-0 flex-col', className)}
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
            <span data-slot="daily-bars-message" className="text-body-sm text-text-2">
              {words}
            </span>
            {failed && hasText(detail) && (
              <span
                data-slot="daily-bars-detail"
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

  const w = plotWidth ?? FALLBACK_WIDTH;
  const plotH = height - INSET.top - INSET.bottom;
  const yOf = (v) => round2(INSET.top + (1 - (v - axis.lo) / (axis.hi - axis.lo)) * plotH);
  const baseline = height - INSET.bottom;
  const slot = w / n;
  const barW = Math.min(Math.max(slot * 0.64, 2), MAX_BAR);
  const centre = (i) => round2(slot * (i + 0.5));
  const isPartial = (i) => partial && i === last;

  // Labels under the bars: every stride-th day counting back from the newest,
  // so the latest day is always named, and wide enough apart not to touch.
  const ticks = data.map((d, i) => ({ i, text: formatTick(d.time) }));
  const widest = Math.max(...ticks.map((t) => t.text.length)) * 7;
  const stride = Math.max(1, Math.ceil((widest + 8) / slot));
  const shown = ticks.filter(({ i, text }) => {
    const half = (text.length * 7) / 2;
    return (last - i) % stride === 0 && centre(i) - half >= -4 && centre(i) + half <= w + 4;
  });

  const valueWords = (d, i) =>
    d.value == null
      ? 'No data'
      : isPartial(i) && hasText(partialWord)
        ? `${formatValue(d.value)} ${partialWord}`
        : formatValue(d.value);
  const words = (d, i) =>
    [`${formatDay(d.time)}: ${valueWords(d, i)}`, hasText(d.note) ? d.note : null]
      .filter(Boolean)
      .join(', ');

  const latest = data[last];
  const summary = readings.length
    ? `Latest ${words(latest, last)}. Lowest ${formatValue(Math.min(...readings))}, highest ${formatValue(Math.max(...readings))}. The arrow keys read each day.`
    : 'No readings in this range. The arrow keys read each day.';

  const open = active != null && !dismissed && (hovering || focused);
  const move = (i) => {
    setActive(i);
    setDismissed(false);
  };
  const onPointerMove = (e) => {
    if (e.pointerType === 'touch') return;
    const box = plotRef.current?.getBoundingClientRect();
    if (!box?.width) return;
    const x = ((e.clientX - box.left) / box.width) * w;
    const i = Math.min(Math.max(Math.floor(x / slot), 0), last);
    setHovering(true);
    if (i !== active) move(i);
  };
  const onPointerLeave = () => {
    setHovering(false);
    if (!focused) setActive(null);
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
    const next = to(active ?? last, last);
    move(next);
    setSaid(words(data[next], next));
  };

  const point = open ? active : null;
  const pointX = point == null ? null : centre(point);
  const tipLeft = pointX != null && pointX <= w / 2;
  const tip = point == null ? null : data[point];
  const longestTick = axis.ticks.reduce(
    (a, t) => (formatValue(t).length > a.length ? formatValue(t) : a),
    ''
  );

  return (
    <figure
      data-slot="daily-bars"
      data-state="ready"
      className={cn('m-0 flex min-w-0 flex-col', className)}
      {...props}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div
          data-slot="daily-bars-y"
          aria-hidden="true"
          className="relative text-caption text-text-3"
        >
          <span className="invisible block h-0 overflow-hidden whitespace-nowrap">
            {longestTick}
          </span>
          {axis.ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
              style={{ top: yOf(t) }}
            >
              {formatValue(t)}
            </span>
          ))}
        </div>
        <div
          ref={plotRef}
          data-slot="daily-bars-plot"
          role="img"
          tabIndex={0}
          aria-label={label}
          aria-describedby={`${id}-summary`}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true);
            if (active == null) move(last);
          }}
          onBlur={() => {
            setFocused(false);
            setDismissed(false);
            if (!hovering) setActive(null);
          }}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          className="relative min-w-0 rounded-sm"
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
            {axis.ticks.map((t, i) => (
              <line
                key={t}
                data-slot="daily-bars-grid"
                x1="0"
                x2={w}
                y1={yOf(t)}
                y2={yOf(t)}
                className={i === 0 ? 'stroke-border' : 'stroke-border-subtle'}
                strokeWidth="1"
                shapeRendering="crispEdges"
              />
            ))}
            {point != null && (
              <line
                data-slot="daily-bars-crosshair"
                x1={pointX}
                x2={pointX}
                y1="0"
                y2={height}
                className="stroke-border-strong"
                strokeWidth="1"
                shapeRendering="crispEdges"
              />
            )}
            {data.map((d, i) => {
              if (d.value == null) return null;
              const y = Math.min(yOf(d.value), baseline - 1);
              const part = isPartial(i);
              return (
                <rect
                  key={d.key ?? i}
                  data-slot="daily-bars-bar"
                  data-partial={part ? '' : undefined}
                  x={round2(centre(i) - barW / 2)}
                  y={y}
                  width={barW}
                  height={round2(baseline - y)}
                  rx="2"
                  className={part ? 'fill-series-1/40 stroke-series-1' : 'fill-series-1'}
                  strokeWidth={part ? 1.5 : undefined}
                  strokeDasharray={part ? '4 3' : undefined}
                />
              );
            })}
          </svg>
          {tip != null && (
            <div
              data-slot="daily-bars-tooltip"
              aria-hidden="true"
              className="pointer-events-none absolute top-0 z-dialog flex flex-col gap-0.5 rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-caption whitespace-nowrap text-text-1 shadow-pop"
              style={tipLeft ? { left: pointX + 10 } : { right: w - pointX + 10 }}
            >
              <span className="text-text-2">{formatDay(tip.time)}</span>
              <span className="flex items-baseline gap-1.5">
                <span className={tip.value == null ? 'text-text-2' : 'font-bold'}>
                  {tip.value == null ? 'No data' : formatValue(tip.value)}
                </span>
                {tip.value != null && isPartial(point) && hasText(partialWord) && (
                  <span className="text-text-2">{partialWord}</span>
                )}
              </span>
              {hasText(tip.note) && <span className="text-text-2">{tip.note}</span>}
            </div>
          )}
        </div>
        <div aria-hidden="true" />
        <div
          data-slot="daily-bars-x"
          aria-hidden="true"
          className="relative h-4 text-caption text-text-3"
        >
          {shown.map(({ i, text }) => (
            <span
              key={i}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
              style={{ left: centre(i) }}
            >
              {text}
            </span>
          ))}
        </div>
      </div>
      {partial && latest.value != null && hasText(partialWord) && (
        <p data-slot="daily-bars-partial" className="m-0 mt-1 text-caption text-text-2">
          {`${formatDay(latest.time)}: ${valueWords(latest, last)} (the day isn't over)`}
        </p>
      )}
      <span id={`${id}-summary`} hidden>
        {summary}
      </span>
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
    </figure>
  );
}

export { DailyBars };
