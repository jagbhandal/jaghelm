/*
 * StatusWord and StatusBadge (spec §5.2, §5.4; #287): a status said in words,
 * in its word colour, so status never rests on colour alone.
 *
 * StatusWord, `ui` look: the mock's status word, bold in the state's `fg`
 * (which carries 4.5:1 on the page, the panels, hovered rows and its own
 * tint), at the size around it. `word` is what it says ("Down", "On
 * battery"); without one it reads its state's word ("Warning", "No signal").
 *
 * StatusBadge (`ui` only): the word with its lamp on the state's tint, inside
 * its border, 4px round (§5.3's badge radius). The mock draws no badge; it is
 * derived from the mock's tinted tiles and rows, for a status inside a table
 * cell or a line of text. The lamp is decorative there: the word beside it
 * names the status.
 *
 * StatusWord, `android` look (a stopgap until #326): the Android app's mono,
 * weight-500, upper-case word, coloured by its own tokens (lib/status.js).
 */
import { StatusLamp } from './status-lamp.jsx';
import { cn } from './lib/utils.js';
import { WORDS, toSeverity, toState } from './lib/status.js';

const fg = {
  ok: 'text-ok-fg',
  warn: 'text-warn-fg',
  crit: 'text-crit-fg',
  unknown: 'text-unknown-fg',
  maintenance: 'text-maintenance-fg',
};

const badge = {
  ok: 'border-ok-border bg-ok-tint text-ok-fg',
  warn: 'border-warn-border bg-warn-tint text-warn-fg',
  crit: 'border-crit-border bg-crit-tint text-crit-fg',
  unknown: 'border-unknown-border bg-unknown-tint text-unknown-fg',
  maintenance: 'border-maintenance-border bg-maintenance-tint text-maintenance-fg',
};

// The Android app's word colours: its own tokens, in MobileApp.css.
const ANDROID_COLOURS = {
  critical: 'var(--red)',
  caution: 'var(--amber)',
  healthy: 'var(--green)',
  unknown: 'var(--steel)',
};

function AndroidStatusWord({ state, severity, word, ...props }) {
  const sev = toSeverity(state ?? severity);
  return (
    <span
      className={`status-word word--${sev}`}
      style={{
        fontFamily: 'var(--mono)',
        fontWeight: 500,
        textTransform: 'uppercase',
        color: ANDROID_COLOURS[sev] ?? 'var(--steel)',
      }}
      {...props}
    >
      {(word ?? WORDS[toState(sev)]).toUpperCase()}
    </span>
  );
}

function StatusWord(props) {
  if (__ANDROID_LOOK__) return <AndroidStatusWord {...props} />;
  return <UiStatusWord {...props} />;
}

function UiStatusWord({ state, severity, word, className, ...props }) {
  const s = toState(state ?? severity);
  return (
    <span
      data-slot="status-word"
      data-state={s}
      className={cn('font-bold', fg[s], className)}
      {...props}
    >
      {word || WORDS[s]}
    </span>
  );
}

function StatusBadge({ state, severity, word, className, ...props }) {
  const s = toState(state ?? severity);
  return (
    <span
      data-slot="status-badge"
      data-state={s}
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-sm border px-1.5 text-caption font-semibold whitespace-nowrap',
        badge[s],
        className
      )}
      {...props}
    >
      <StatusLamp state={s} decorative />
      {word || WORDS[s]}
    </span>
  );
}

export { StatusWord, StatusBadge };
