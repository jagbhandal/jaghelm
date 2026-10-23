/*
 * UptimeBar (spec §5.4, §6.2; #288, #312): a monitor's recent checks as a
 * Kuma-style heartbeat strip, oldest on the left, the mock's ("Heartbeats ·
 * only failures light up" on its Tokens board).
 *
 * `beats` holds one per check, oldest first: a state (`ok`, `warn`, `crit`,
 * `unknown` or `maintenance`), or null where there is no check, or a check
 * as the server's strips give them (#312, server/kumaBeats.js decodeBeats):
 * `{ state, word, time, ping }`, Kuma's "Up", "Down", "Pending",
 * "Maintenance" or "No data", when (ms), and the response time (ms). Only
 * failures light up: a `crit` beat is `crit-solid`, a `warn` beat (Kuma's
 * pending) `warn-solid`; every other check is the quiet `beat-ok`,
 * maintenance included (planned work is not an issue, spec §6.1); a beat
 * with no data is a hollow ring of `border-strong`, as the mock's no-signal
 * service. `stale` (a stale status, #480: nothing is drawn in a level's
 * colour) draws a failing or pending check in no signal's solid instead, as
 * a stale meter's fill, so the strip keeps its shape as last known.
 *
 * Beats are 2px round and 2px apart: `sm` 4 × 16px (the rows), `md` 6 × 22px
 * (the detail drawer), `lg` 8 × 26px (the phone's detail sheet, where
 * `justify-between` spreads them). `count` pads the oldest end with empty
 * beats and keeps the newest, so strips in a list line up; BeatSpace is the
 * room such a strip takes, empty and hidden, for a row in that list with no
 * monitor, which draws no strip (#312).
 *
 * It is an image named by what it shows, "Heartbeats: 2 failures in the last
 * 30 checks", counting only checks with data; a strip with no data at all says
 * so ("No data in the last 30 checks"), and one with no checks "No checks
 * yet". The name is hidden text inside it, so a row that holds it (EntityRow)
 * is described by it too.
 *
 * A check given as an object has a tooltip (#312): its word, its time to the
 * second and its response time ("Down 14:32:10", "Up 14:32:40 138 ms"), for
 * the beat under the pointer (never on touch). `focusable` (the drawer's and
 * the phone sheet's strip, not one inside a row that opens: a control inside
 * a control) puts it in the tab order too, as the Sparkline is: focus starts
 * at the newest check, the arrows, Home and End move, Escape closes, and a
 * polite live region says each check the arrows reach, so the tooltip itself
 * is hidden from assistive tech. The tooltip is the Sparkline's readout, in
 * the floating layer (lib/floating.jsx; floating/sparkline-tip.jsx), which
 * loads on the page's first input.
 */
import { useId, useRef, useState } from 'react';
import { cn } from './lib/utils.js';
import { STATES } from './lib/status.js';
import { useOverlayPortal } from './lib/portal.js';
import { useFloatingLayer } from './lib/floating.jsx';

const colours = {
  ok: 'bg-beat-ok',
  maintenance: 'bg-beat-ok',
  warn: 'bg-warn-solid',
  crit: 'bg-crit-solid',
  none: 'inset-ring inset-ring-border-strong',
};

// A failing or pending check with a stale status: no level colour (#480).
const STALE = { warn: 'bg-unknown-solid', crit: 'bg-unknown-solid' };

const sizes = {
  sm: 'w-1 h-4',
  md: 'w-1.5 h-5.5',
  lg: 'w-2 h-6.5',
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

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** A check's parts as its tooltip shows them: its word, its time, its response time. */
function checkParts(b) {
  return {
    word: b.word || 'No data',
    time: Number.isFinite(b.time) ? TIME.format(new Date(b.time)) : null,
    ping: Number.isFinite(b.ping) && b.ping > 0 ? `${Math.round(b.ping)} ms` : null,
  };
}

/** A check in words, as the live region says it: "Down at 14:32:10", "Up at 14:32:40, 138 ms". */
function checkWords(b) {
  const { word, time, ping } = checkParts(b);
  return [time ? `${word} at ${time}` : word, ping].filter(Boolean).join(', ');
}

/**
 * What a strip of beats shows, in words: its failures and warnings in the
 * checks that have data, and whether the latest failed.
 */
export function beatSummary(beats = []) {
  const states = beats.map(stateOf);
  const checks = beats.map(beatOf).filter((b) => b !== 'none');
  if (!checks.length) {
    // Checks with no signal (a source down) are not a monitor that has none yet.
    const unknown = states.filter((b) => b === 'unknown').length;
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

/**
 * How often a strip's checks come, in words, from the middle gap between
 * their times: "every 30 s", "every 5 min"; null with fewer than two timed
 * checks. The drawer's heading says it, as the mock's "every 30 s".
 */
export function beatCadence(beats = []) {
  const times = beats.map((b) => (isCheck(b) ? b.time : null)).filter(Number.isFinite);
  if (times.length < 2) return null;
  const gaps = times
    .slice(1)
    .map((t, i) => t - times[i])
    .sort((a, b) => a - b);
  const seconds = Math.round(gaps[Math.floor(gaps.length / 2)] / 1000);
  if (seconds <= 0) return null;
  return seconds < 120 ? `every ${seconds} s` : `every ${Math.round(seconds / 60)} min`;
}

const KEYS = {
  ArrowLeft: (i) => Math.max(i - 1, 0),
  ArrowDown: (i) => Math.max(i - 1, 0),
  ArrowRight: (i, last) => Math.min(i + 1, last),
  ArrowUp: (i, last) => Math.min(i + 1, last),
  Home: () => 0,
  End: (i, last) => last,
};

function UptimeBar({
  beats = [],
  count,
  size = 'sm',
  label = 'Heartbeats',
  focusable = false,
  stale = false,
  className,
  ...props
}) {
  const id = useId();
  const rootRef = useRef(null);
  const shown = count == null ? beats : beats.slice(-count);
  const pad = count == null ? 0 : Math.max(count - shown.length, 0);
  const padded = [...Array.from({ length: pad }, () => null), ...shown];
  // The tooltip: the shown check it is on (an index into `shown`), if any.
  const [active, setActive] = useState(null);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [said, setSaid] = useState('');
  const tips = shown.some(isCheck);
  const keys = tips && focusable;
  const tip = active == null ? null : shown[active];
  const open = isCheck(tip) && !dismissed && (hovering || focused);
  const [portalRoot, openChange] = useOverlayPortal(rootRef, open, (next) => {
    if (!next) setDismissed(true);
  });
  const layer = useFloatingLayer(open);
  const last = shown.length - 1;

  const move = (i) => {
    setActive(i);
    setDismissed(false);
  };

  const pointer = tips
    ? {
        onPointerMove: (e) => {
          if (e.pointerType === 'touch') return;
          const beat = e.target?.closest?.('[data-slot="beat"]');
          if (!beat || !rootRef.current?.contains(beat)) return;
          const i = Number(beat.dataset.check);
          setHovering(true);
          if (!Number.isInteger(i) || i < 0) setActive(focused ? active : null);
          else if (i !== active) move(i);
        },
        onPointerLeave: () => {
          setHovering(false);
          if (!focused) setActive(null);
        },
      }
    : {};

  const keyboard = keys
    ? {
        tabIndex: 0,
        'aria-describedby': `${id}-how`,
        onKeyDown: (e) => {
          if (e.key === 'Escape') {
            if (open) {
              e.preventDefault();
              setDismissed(true);
            }
            return;
          }
          const to = KEYS[e.key];
          if (!to || last < 0) return;
          e.preventDefault();
          const next = to(active ?? last, last);
          move(next);
          setSaid(checkWords(shown[next]));
        },
        onFocus: () => {
          setFocused(true);
          if (active == null && last >= 0) move(last);
        },
        onBlur: () => {
          setFocused(false);
          setDismissed(false);
          if (!hovering) setActive(null);
        },
      }
    : {};

  // Above the strip, over the check: the tooltip never covers a beat.
  const anchor = {
    getBoundingClientRect() {
      const el = rootRef.current?.querySelector(`[data-check="${active}"]`);
      const box = el?.getBoundingClientRect() ?? new DOMRect();
      return new DOMRect(box.left + box.width / 2, box.top, 0, 0);
    },
  };
  const parts = isCheck(tip) ? checkParts(tip) : null;

  return (
    <>
      <span
        ref={rootRef}
        data-slot="uptime-bar"
        role="img"
        aria-labelledby={`${id}-name`}
        className={cn('relative flex w-fit gap-0.5', keys && 'rounded-xs', className)}
        {...pointer}
        {...keyboard}
        {...props}
      >
        {/* Its name as text, not an aria-label, so a row it sits in can be
            described by it (aria-describedby reads text, not a nested label). */}
        <span id={`${id}-name`} className="sr-only">
          {`${label}: ${beatSummary(shown)}`}
        </span>
        {padded.map((b, i) => {
          const beat = beatOf(b);
          const check = i - pad;
          return (
            <span
              key={i}
              data-slot="beat"
              data-beat={beat}
              data-check={check >= 0 ? check : undefined}
              data-active={open && check === active ? '' : undefined}
              className={cn(
                'shrink-0 rounded-xs',
                sizes[size] ?? sizes.sm,
                (stale && STALE[beat]) || colours[beat],
                open && check === active && 'outline-1 outline-offset-1 outline-text-3'
              )}
            />
          );
        })}
      </span>
      {keys && (
        <>
          <span id={`${id}-how`} hidden>
            The arrow keys read each check.
          </span>
          <span className="sr-only" aria-live="polite">
            {said}
          </span>
        </>
      )}
      {tips && layer ? (
        <layer.SparklineTip
          open={open}
          onOpenChange={openChange}
          portalRoot={portalRoot}
          anchor={anchor}
          slot="uptime-bar-tooltip"
        >
          {parts && (
            <>
              <span className="font-bold">{parts.word}</span>
              {parts.time && <span className="text-text-2">{parts.time}</span>}
              {parts.ping && <span className="text-text-2">{parts.ping}</span>}
            </>
          )}
        </layer.SparklineTip>
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
