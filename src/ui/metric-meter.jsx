/*
 * MetricMeter (spec §5.2, §5.4, §6.1; #288): one reading as a bar, the mock's
 * node-card meter ("Meters · violet until a threshold" on its Tokens board): an
 * overline label and the value over a 6px round track with quarter ticks.
 *
 * Below its threshold the fill is the accent's meter colour (`bg-meter`, §15).
 * At or above a threshold it turns to a status colour, `warn-solid` or
 * `crit-solid`, and the value is printed in that state's word colour: a meter
 * changes colour only above its threshold (rule 3). The threshold it leaves the
 * accent at is cut into the track (the threshold tick), so a reading past it
 * shows without colour.
 *
 * Ported from the retired Android app's UsageBar: the fill clamps to the track while the
 * value prints as read, or as `valueText`; no reading (null) draws an empty
 * track and a dash in the no-signal colour. The value prints by the status
 * model's one rule for a reading (`shownReading`, server/status/readings.js,
 * #450), the one its reasons use: rounded down, so 94.6 by a 95 line reads 94,
 * never at a line it is under; beside a line with a fraction (87.5), to that
 * line's decimals. `band` is the hysteresis in the same unit (readingLines
 * gives it), so a reading held over a clear line with a fraction reads over it
 * too. UsageBar's fixed 75/90 steps give way to `warn` and
 * `crit`, in the reading's unit, and the server's own state, when given, wins
 * over them (its hysteresis keeps a warning until the reading drops 5 points).
 * A screen gives a node reading's meter the lines /api/status serves, the ones
 * the model judged it by: `readingLines(status.thresholds, reading)` from
 * server/status/readings.js (#451), never lines of its own.
 *
 * A reading the server gave no current level (`state` 'unknown': the status
 * it was judged by is stale, #495) is drawn as no signal: the fill in the
 * steel no-signal colour and the value in text-2, said as "94%, no signal",
 * never coloured by a line and never judged here.
 *
 * A meter is a `meter` named by its label, its value and any threshold it
 * passed said in words ("92%, warning above 90%"). A meter never sits on
 * `surface-3`, and a chart beside it is a Sparkline (docs/design-system.md,
 * "Data components").
 */
import { useId } from 'react';
import { atOrOver, lineNumber, shownReading } from '../../server/status/readings.js';
import { cn } from './lib/utils.js';

const fills = {
  ok: 'bg-meter',
  warn: 'bg-warn-solid',
  crit: 'bg-crit-solid',
  unknown: 'bg-unknown-solid',
};

const words = {
  ok: 'text-text-1',
  warn: 'text-warn-fg',
  crit: 'text-crit-fg',
  unknown: 'text-text-2',
};

const SAID = { warn: 'warning', crit: 'critical', unknown: 'no signal' };

const isReading = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The state of a reading against its thresholds: `crit` at or above `crit`,
 * `warn` at or above `warn`, `ok` below both, `unknown` without a reading.
 * "At or above" is the status model's own comparison (atOrOver, #450): on its
 * grid of whole hundredths, so a reading exactly on a line is on it.
 */
export function meterState(value, { warn, crit } = {}) {
  if (!isReading(value)) return 'unknown';
  if (isReading(crit) && atOrOver(value, crit)) return 'crit';
  if (isReading(warn) && atOrOver(value, warn)) return 'warn';
  return 'ok';
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function MetricMeter({
  label,
  value,
  max = 100,
  unit = '%',
  warn,
  crit,
  band,
  state,
  valueText,
  className,
  ...props
}) {
  const id = useId();
  const read = isReading(value);
  const s = read && Object.hasOwn(fills, state) ? state : meterState(value, { warn, crit });
  const shown = valueText ?? (read ? `${shownReading(value, { warn, crit, band })}${unit}` : null);
  const pct = read ? clamp((value / max) * 100, 0, 100) : 0;
  // The threshold it leaves the accent at: warn, or crit when there is no warn.
  const turn = isReading(warn) ? warn : isReading(crit) ? crit : null;
  const turnAt = turn == null ? null : (turn / max) * 100;
  // The threshold the reading is past, when it is (the server's state may hold a
  // warning below it).
  const limit = s === 'crit' ? crit : s === 'warn' ? warn : null;
  const passed = isReading(limit) && atOrOver(value, limit) ? limit : null;
  const word = passed != null ? `${SAID[s]} above ${lineNumber(passed)}${unit}` : SAID[s];
  const said = s === 'ok' ? shown : `${shown}, ${word}`;

  const meter = read
    ? {
        role: 'meter',
        'aria-labelledby': `${id}-label`,
        'aria-valuemin': 0,
        'aria-valuemax': max,
        'aria-valuenow': clamp(value, 0, max),
        'aria-valuetext': said,
      }
    : {};

  return (
    <div
      data-slot="metric-meter"
      data-state={s}
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
      {...meter}
      {...props}
    >
      <span className="flex min-w-0 items-baseline justify-between gap-2">
        <span id={`${id}-label`} className="truncate text-overline leading-5 text-text-3 uppercase">
          {label}
        </span>
        {read ? (
          <span className={cn('shrink-0 text-body-sm leading-5 font-bold', words[s])}>{shown}</span>
        ) : (
          <span className="shrink-0 text-body-sm leading-5 font-bold">
            <span aria-hidden="true" className="text-unknown-fg">
              —
            </span>
            <span className="sr-only">No data</span>
          </span>
        )}
      </span>
      <span
        data-slot="meter-track"
        className="relative block h-1.5 overflow-hidden rounded-full bg-track"
      >
        {[25, 50, 75].map((at) => (
          <span
            key={at}
            data-slot="meter-tick"
            className="absolute inset-y-0 w-px bg-tick"
            style={{ left: `${at}%` }}
          />
        ))}
        {read && (
          <span
            data-slot="meter-fill"
            className={cn('absolute inset-y-0 left-0 rounded-full transition-[width]', fills[s])}
            style={{ width: `${pct}%` }}
          />
        )}
        {turnAt != null && turnAt > 0 && turnAt < 100 && (
          <span
            data-slot="meter-threshold"
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-lamp-cut"
            style={{ left: `${turnAt}%` }}
          />
        )}
      </span>
    </div>
  );
}

export { MetricMeter };
