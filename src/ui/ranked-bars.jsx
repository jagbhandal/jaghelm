/*
 * RankedBars (Monitoring spec §5, charts 3 and 6; #748): horizontal bars, one
 * a row, in the order the caller gives them. The disk runway (days left,
 * soonest first) and the container growers (7-day memory growth, biggest
 * first) are these; the caller sorts, the chart never does, so a ranking and
 * its status can't disagree.
 *
 * `rows` are `{ key, name, value, valueText, state, points, stateLabel }`. A
 * row's value is always printed (`valueText`, else `formatValue(value)`, "No
 * data" for a missing one): the bar is the shape of the number, never the
 * only place it lives. `state` puts a status lamp before the name, so a
 * flagged row says so in shape and word (docs/design-system.md, rule 3) and
 * the bar stays as every bar is: one series by design, so slot 1, azure, never
 * a status colour and never recoloured when a row is flagged ("Chart
 * colours"). `points` draw that row's trend as a Sparkline (sparkline.jsx),
 * also slot 1, on the row's right. Bars run from 0 to `max` (the largest
 * value by default); a value under 0 or missing draws no bar.
 *
 * Drawn as one image named by `label` and described by every row in words
 * (rank, name, value, status), so nothing lives only in the picture. It takes
 * focus: focus starts at the first row, the arrows, Home and End move the
 * row's highlight (`row-hover`, a selection-free mark), Escape clears it, and
 * a polite live region says each row the arrows reach. The row sparklines are
 * `decorative`: they are inside this image, which names them.
 *
 * `state`: 'ready' draws the rows; 'loading' a placeholder; 'failed' says
 * "No data from Prometheus" (or `failedText`; `detail`: why), never an empty
 * list that reads as healthy; no rows says `emptyText`.
 */
import { useId, useMemo, useState } from 'react';
import { cn } from './lib/utils.js';
import { hasText } from './lib/name.js';
import { isReading } from './lib/chart.js';
import { WORDS, toState } from './lib/status.js';
import { StatusLamp } from './status-lamp.jsx';
import { Sparkline } from './sparkline.jsx';

const BAR_HEIGHT = 10;
const LAMP_PX = 10;
const SPARK = { width: 72, height: 20 };
const LOADING_ROWS = 4;

const KEYS = {
  ArrowLeft: (i) => Math.max(i - 1, 0),
  ArrowUp: (i) => Math.max(i - 1, 0),
  ArrowRight: (i, last) => Math.min(i + 1, last),
  ArrowDown: (i, last) => Math.min(i + 1, last),
  Home: () => 0,
  End: (i, last) => last,
};

function RankedBars({
  label,
  rows = [],
  max,
  formatValue = (v) => String(Math.round(v)),
  state = 'ready',
  detail,
  failedText = 'No data from Prometheus',
  emptyText = 'Nothing to rank',
  className,
  ...props
}) {
  const id = useId();
  const [active, setActive] = useState(null);
  const [said, setSaid] = useState('');

  if (!hasText(label)) {
    const message = 'RankedBars needs a `label`: it has no name';
    if (import.meta.env.DEV) throw new Error(message);
    console.error(message);
  }

  const list = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        value: isReading(r.value) ? r.value : null,
        lamp: r.state == null ? null : toState(r.state),
      })),
    [rows]
  );
  const top =
    max ?? Math.max(0, ...list.map((r) => r.value).filter((v) => v != null)); /* the scale's end */
  const textOf = (r) =>
    hasText(r.valueText) ? r.valueText : r.value == null ? 'No data' : formatValue(r.value);
  const wordsOf = (r) =>
    [r.name, textOf(r), r.lamp ? (r.stateLabel ?? WORDS[r.lamp]) : null].filter(Boolean).join(', ');

  if (state !== 'ready' || list.length === 0) {
    const loading = state === 'loading';
    const failed = state === 'failed';
    const words = failed ? failedText : emptyText;
    return (
      <figure
        data-slot="ranked-bars"
        data-state={loading ? 'loading' : failed ? 'failed' : 'empty'}
        className={cn('m-0 flex min-w-0 flex-col', className)}
        {...props}
      >
        {loading ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <span className="sr-only">{`${label}: loading`}</span>
            {Array.from({ length: LOADING_ROWS }, (_, i) => (
              <div key={i} aria-hidden="true" className="h-5 rounded-md bg-surface-3" />
            ))}
          </div>
        ) : (
          <div
            role="img"
            aria-label={`${label}: ${words}`}
            className="flex min-h-16 flex-col items-center justify-center gap-0.5 border-b border-border px-4 py-3 text-center"
          >
            <span data-slot="ranked-bars-message" className="text-body-sm text-text-2">
              {words}
            </span>
            {failed && hasText(detail) && (
              <span
                data-slot="ranked-bars-detail"
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

  const last = list.length - 1;
  const anyLamp = list.some((r) => r.lamp);
  const anySpark = list.some((r) => r.points?.length > 1);
  const summary = `Ranked as listed. ${list.map((r, i) => `${i + 1}, ${wordsOf(r)}`).join('. ')}. The arrow keys read each row.`;

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (active != null) {
        e.preventDefault();
        setActive(null);
      }
      return;
    }
    const to = KEYS[e.key];
    if (!to) return;
    e.preventDefault();
    const next = to(active ?? 0, last);
    setActive(next);
    setSaid(`${next + 1} of ${list.length}, ${wordsOf(list[next])}`);
  };

  return (
    <figure
      data-slot="ranked-bars"
      data-state="ready"
      className={cn('m-0 flex min-w-0 flex-col', className)}
      {...props}
    >
      <div
        data-slot="ranked-bars-rows"
        role="img"
        tabIndex={0}
        aria-label={label}
        aria-describedby={`${id}-summary`}
        onKeyDown={onKeyDown}
        onFocus={() => active == null && setActive(0)}
        onBlur={() => setActive(null)}
        className={cn(
          'grid items-center gap-x-3 rounded-sm',
          anySpark
            ? 'grid-cols-[auto_minmax(0,1fr)_auto_auto]'
            : 'grid-cols-[auto_minmax(0,1fr)_auto]'
        )}
      >
        {list.map((r, i) => {
          const share = r.value == null || !(top > 0) ? 0 : Math.min(r.value / top, 1);
          return (
            <div
              key={r.key ?? i}
              data-slot="ranked-bars-row"
              data-key={r.key}
              data-active={active === i ? '' : undefined}
              className="col-span-full grid grid-cols-subgrid items-center rounded-sm px-1 py-1 hover:bg-row-hover data-active:bg-row-hover"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-body-sm text-text-1">
                {anyLamp &&
                  (r.lamp ? (
                    <StatusLamp state={r.lamp} size={LAMP_PX} decorative />
                  ) : (
                    <span aria-hidden="true" className="shrink-0" style={{ width: LAMP_PX }} />
                  ))}
                <span className="wrap-anywhere">{r.name}</span>
              </span>
              <svg
                data-slot="ranked-bars-track"
                width="100%"
                height={BAR_HEIGHT}
                aria-hidden="true"
                focusable="false"
                className="block"
              >
                <line
                  x1="0.5"
                  x2="0.5"
                  y1="0"
                  y2={BAR_HEIGHT}
                  className="stroke-border-strong"
                  strokeWidth="1"
                  shapeRendering="crispEdges"
                />
                {share > 0 && (
                  <rect
                    data-slot="ranked-bars-bar"
                    x="1"
                    y="0"
                    width={`${Math.max(share * 100, 0.5)}%`}
                    height={BAR_HEIGHT}
                    rx="2"
                    className="fill-series-1"
                  />
                )}
              </svg>
              <span
                data-slot="ranked-bars-value"
                className={cn(
                  'text-right text-body-sm whitespace-nowrap tabular-nums',
                  r.value == null && !hasText(r.valueText) ? 'text-text-2' : 'font-semibold'
                )}
              >
                {textOf(r)}
              </span>
              {anySpark && (
                <span className="flex justify-end" style={{ minWidth: SPARK.width }}>
                  {r.points?.length > 1 && (
                    <Sparkline
                      decorative
                      points={r.points}
                      domain="auto"
                      formatValue={r.formatPoint ?? formatValue}
                      {...SPARK}
                    />
                  )}
                </span>
              )}
            </div>
          );
        })}
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

export { RankedBars };
