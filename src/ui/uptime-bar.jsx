/*
 * UptimeBar (spec §5.4, §6.2; #288): a monitor's recent checks as a Kuma-style
 * heartbeat strip, oldest on the left, the mock's ("Heartbeats · only failures
 * light up" on its Tokens board).
 *
 * `beats` holds one state per check, from the status model: `ok`, `warn`,
 * `crit`, `unknown` or `maintenance`, or null where there is no check. Only
 * failures light up: a `crit` beat is `crit-solid`, a `warn` beat (Kuma's
 * pending) `warn-solid`; every other check is the quiet `beat-ok`, maintenance
 * included (planned work is not an issue, spec §6.1); a beat with no data is a
 * hollow ring of `border-strong`, as the mock's no-signal service.
 *
 * Beats are 2px round and 2px apart: `sm` 4 × 16px (the Overview's rows),
 * `md` 6 × 22px (the detail drawer), `lg` 8 × 26px (the phone's detail screen,
 * where `justify-between` spreads them). `count` pads the oldest end with
 * empty beats and keeps the newest, so strips in a list line up.
 *
 * It is an image named by what it shows, "Heartbeats: 2 failures in the last
 * 30 checks", counting only checks with data; a strip with no data at all says
 * so ("No data in the last 30 checks"), and one with no checks "No checks
 * yet". The name is hidden text inside it, so a row that holds it (EntityRow)
 * is described by it too.
 */
import { useId } from 'react';
import { cn } from './lib/utils.js';
import { STATES } from './lib/status.js';

const colours = {
  ok: 'bg-beat-ok',
  maintenance: 'bg-beat-ok',
  warn: 'bg-warn-solid',
  crit: 'bg-crit-solid',
  none: 'inset-ring inset-ring-border-strong',
};

const sizes = {
  sm: 'w-1 h-4',
  md: 'w-1.5 h-5.5',
  lg: 'w-2 h-6.5',
};

/** A beat's look: its state, or `none` without a check. */
const beatOf = (b) => (STATES.includes(b) && b !== 'unknown' ? b : 'none');

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What a strip of beats shows, in words: its failures and warnings in the
 * checks that have data, and whether the latest failed.
 */
export function beatSummary(beats = []) {
  const checks = beats.map(beatOf).filter((b) => b !== 'none');
  if (!checks.length) {
    // Checks with no signal (a source down) are not a monitor that has none yet.
    const unknown = beats.filter((b) => b === 'unknown').length;
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

function UptimeBar({ beats = [], count, size = 'sm', label = 'Heartbeats', className, ...props }) {
  const id = useId();
  const shown = count == null ? beats : beats.slice(-count);
  const padded =
    count == null || shown.length >= count
      ? shown
      : [...Array.from({ length: count - shown.length }, () => null), ...shown];
  return (
    <span
      data-slot="uptime-bar"
      role="img"
      aria-labelledby={`${id}-name`}
      className={cn('relative flex gap-0.5', className)}
      {...props}
    >
      {/* Its name as text, not an aria-label, so a row it sits in can be
          described by it (aria-describedby reads text, not a nested label). */}
      <span id={`${id}-name`} className="sr-only">
        {`${label}: ${beatSummary(shown)}`}
      </span>
      {padded.map((b, i) => {
        const beat = beatOf(b);
        return (
          <span
            key={i}
            data-slot="beat"
            data-beat={beat}
            className={cn('shrink-0 rounded-xs', sizes[size] ?? sizes.sm, colours[beat])}
          />
        );
      })}
    </span>
  );
}

export { UptimeBar };
