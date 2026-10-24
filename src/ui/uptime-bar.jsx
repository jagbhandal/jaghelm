/*
 * UptimeBar (spec §5.4, §6.2; #288, #312): a monitor's recent checks as a
 * Kuma-style heartbeat strip, oldest on the left. A healthy check is green
 * (#629), as in Kuma, not the mock's faint "only failures light up".
 *
 * `beats` holds one per check, oldest first: a state (`ok`, `warn`, `crit`,
 * `unknown` or `maintenance`), or null where there is no check, or a check
 * as the server's strips give them (#312, server/kumaBeats.js decodeBeats):
 * `{ state, time, ping }`, when (ms) and the response time (ms). A
 * a `crit` beat is `crit-solid`, a `warn` beat (Kuma's pending)
 * `warn-solid`, an `ok` beat `beat-ok` (the ok solid, green); maintenance
 * stays the quiet `beat-quiet` (planned work is not an issue, spec §6.1);
 * a beat with no data is a hollow ring of `border-strong`, as the mock's no-signal
 * service. `stale` (a stale status, #480: nothing is drawn in a level's
 * colour) draws a failing or pending check in no signal's solid instead, as a stale
 * meter's fill, and a healthy one as the faint bar, so the strip keeps its
 * shape and where the failures were, as last known.
 *
 * Beats are pills (fully round, as Kuma's) 2px apart: `sm` 4 × 16px (the rows), `md` 6 × 22px
 * (the detail drawer), `lg` 8 × 26px (the phone's detail sheet, where
 * `justify-between` spreads them). `count` pads the oldest end with empty
 * beats and keeps the newest, so strips in a list line up; BeatSpace is the
 * room such a strip takes, empty and hidden, for a row in that list with no
 * monitor, which draws no strip (#312). `fit` (the Services table's cell)
 * lets the strip be narrower than its beats, losing its oldest first, as a
 * row's does, down to its newest 12: the beats are laid newest first from
 * the right and wrap onto lines it doesn't show, so it asks its column for
 * all its beats' width at most and 12 beats' at least, and a table short of
 * room narrows it rather than scroll.
 *
 * It is an image named by what it shows, "Heartbeats: 2 failures in the last
 * 30 checks", counting only checks with data; a strip with no data at all says
 * so ("No data in the last 30 checks"), and one with no checks "No checks
 * yet". The name is hidden text inside it, so a row that holds it (EntityRow)
 * is described by it too.
 *
 * A strip of checks has a tooltip (#312): each check's word, time and
 * response time under the pointer (never on touch); `focusable` (the
 * drawer's and the phone sheet's strip, not one inside a row that opens: a
 * control inside a control) puts it in the tab order, its arrows reading
 * each check. That part is the floating layer's (floating/uptime-bar-tips.jsx,
 * which documents it), loaded the first time a pointer comes over a strip
 * or one takes focus, so the rows' first screen carries only this plain
 * strip. It adds nothing to the strip's box (the active beat's mark is
 * drawn by a `data-active` it sets), so a row looks the same before and
 * after it arrives.
 */
import { useId, useRef, useSyncExternalStore } from 'react';
import { cn } from './lib/utils.js';
import { STATES } from './lib/status.js';
import { floatingLayer } from './lib/floating.jsx';

const colours = {
  ok: 'bg-beat-ok',
  maintenance: 'bg-beat-quiet',
  warn: 'bg-warn-solid',
  crit: 'bg-crit-solid',
  none: 'inset-ring inset-ring-border-strong',
};

// A stale status (#480): no level colour. A healthy check is the faint bar, so
// the failures stay where they were; a failing or pending one is steel.
const STALE = { ok: 'bg-beat-quiet', warn: 'bg-unknown-solid', crit: 'bg-unknown-solid' };

const sizes = {
  sm: 'w-1 h-4',
  md: 'w-1.5 h-5.5',
  lg: 'w-2 h-6.5',
};

// A strip that fits its box (`fit`): one line of beats tall, its newest 12
// wide at least (12 beats and the 11 gaps between them).
const fits = {
  sm: 'h-4 min-w-[70px]',
  md: 'h-5.5 min-w-[94px]',
  lg: 'h-6.5 min-w-[118px]',
};

const isCheck = (b) => b !== null && typeof b === 'object';
/** A beat's state, given as one or as a check. */
const stateOf = (b) => (isCheck(b) ? b.state : b);
/** A beat's look: its state, or `none` without a check. */
const beatOf = (b) => {
  const s = stateOf(b);
  return STATES.includes(s) && s !== 'unknown' ? s : 'none';
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What a strip of beats shows, in words: its failures and warnings in the
 * checks that have data, and whether the latest failed.
 */
export function beatSummary(beats = []) {
  const checks = beats.map(beatOf).filter((b) => b !== 'none');
  if (!checks.length) {
    // Checks with no signal (a source down) are not a monitor that has none yet.
    const unknown = beats.filter((b) => stateOf(b) === 'unknown').length;
    if (!unknown) return 'No checks yet';
    return `No data in ${unknown === 1 ? 'the last check' : `the last ${unknown} checks`}`;
  }
  const failed = checks.filter((b) => b === 'crit').length;
  const warned = checks.filter((b) => b === 'warn').length;
  const span = checks.length === 1 ? 'the last check' : `the last ${checks.length} checks`;
  const counted = [failed && plural(failed, 'failure'), warned && plural(warned, 'warning')]
    .filter(Boolean)
    .join(' and ');
  const latest = checks.at(-1) === 'crit' ? ', including the latest' : '';
  return `${counted || 'No failures'} in ${span}${latest}`;
}

// The floating layer once in, without asking for it: a strip asks only when
// it is pointed at or focused.
const layerNow = () => floatingLayer.get();

function UptimeBar({
  beats = [],
  count,
  size = 'sm',
  label = 'Heartbeats',
  focusable = false,
  stale = false,
  fit = false,
  className,
  ...props
}) {
  const id = useId();
  const rootRef = useRef(null);
  const shown = count == null ? beats : beats.slice(-count);
  const pad = count == null ? 0 : Math.max(count - shown.length, 0);
  const padded = [...Array.from({ length: pad }, () => null), ...shown];
  // Fitting its box, newest first from the right: the oldest wrap out of sight.
  const order = padded.map((b, i) => [b, i]);
  if (fit) order.reverse();
  const tips = shown.some(isCheck);
  const keys = tips && focusable;
  const layer = useSyncExternalStore(floatingLayer.subscribe, layerNow, layerNow);
  // The tooltip's part loads the first time a pointer (not a finger) comes
  // over the strip, or it takes focus.
  const wake = tips && !layer && {
    onPointerEnter: (e) => {
      if (e.pointerType !== 'touch') floatingLayer.loadQuietly();
    },
    onFocus: () => floatingLayer.loadQuietly(),
  };
  return (
    <>
      <span
        ref={rootRef}
        data-slot="uptime-bar"
        role="img"
        aria-labelledby={`${id}-name`}
        aria-describedby={keys ? `${id}-how` : undefined}
        tabIndex={keys ? 0 : undefined}
        className={cn(
          'relative flex gap-0.5',
          fit ? cn('flex-row-reverse flex-wrap overflow-hidden', fits[size] ?? fits.sm) : 'w-fit',
          keys && 'rounded-xs',
          className
        )}
        {...wake}
        {...props}
      >
        {/* Its name as text, not an aria-label, so a row it sits in can be
            described by it (aria-describedby reads text, not a nested label). */}
        <span id={`${id}-name`} className="sr-only">
          {`${label}: ${beatSummary(shown)}`}
        </span>
        {order.map(([b, i]) => {
          const beat = beatOf(b);
          const check = i - pad;
          return (
            <span
              key={i}
              data-slot="beat"
              data-beat={beat}
              data-check={check >= 0 ? check : undefined}
              className={cn(
                'shrink-0 rounded-full data-active:outline-1 data-active:outline-offset-1 data-active:outline-text-3',
                sizes[size] ?? sizes.sm,
                (stale && STALE[beat]) || colours[beat]
              )}
            />
          );
        })}
      </span>
      {keys && (
        <span id={`${id}-how`} hidden>
          The arrow keys read each check.
        </span>
      )}
      {tips && layer ? (
        <layer.UptimeBarTips rootRef={rootRef} checks={shown} focusable={keys} />
      ) : null}
    </>
  );
}

/**
 * The room an UptimeBar of `count` beats of `size` takes, empty and hidden
 * from sight and from assistive tech: for a row with no monitor in a list
 * whose other rows have strips, so the rows' meta and strips line up while
 * that row draws no strip (#312). Its beats are the strip's, so a phone-width
 * row (EntityRow: the newest 12) narrows it as it narrows a strip.
 */
function BeatSpace({ count = 30, size = 'sm', className, ...props }) {
  return (
    <span
      data-slot="beat-space"
      aria-hidden="true"
      className={cn('invisible flex gap-0.5', className)}
      {...props}
    >
      {Array.from({ length: count }, (_, i) => (
        <span key={i} data-slot="beat" className={cn('shrink-0', sizes[size] ?? sizes.sm)} />
      ))}
    </span>
  );
}

export { UptimeBar, BeatSpace };
