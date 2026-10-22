/*
 * SubsystemStrip (spec §5.4, §6; #287): each subsystem's worst state and
 * counts at a glance (Services, Nodes, Power, Jobs, Backups, Integrations).
 *
 * `cells` is `[{ key, label, state, word, value, sub }]`: `word` names the
 * state ("Down", "On battery"; the lamp's name), `value` is the headline
 * ("30 / 32", "On battery") and `sub` the line under it, naming what is
 * wrong ("1 down · 1 no signal"), else the OK word ("up"), or the UPS's
 * "64 % charge": the model's own (#541). Both apps build them with
 * src/shell/statusView.js subsystemCells, from the status model (#325).
 *
 * The `ui` look is the mock's joined annunciator strip: tiles 1px apart inside
 * one 12px-round frame, each a lamp and an overline label over the value.
 * A warning, critical or no-signal tile takes its state's tint, over the
 * panel's surface-1 (#289); a maintenance tile stays on the panel, its wrench
 * saying it (spec §6.1: maintenance is not an issue). From 672px (`@2xl` of
 * the strip's container) a tile is the mock's wide one, its value over its
 * `sub`; six share a row from 816px of strip, and sit in rows of three below
 * that (`columns`, below). In rows of three from 320px and of two below that the
 * tiles are the Phone board's, and leave out `sub`. A strip holds one to six
 * tiles, and no row is left with an empty slot. The value and sub are the
 * model's own two lines (#541), drawn as they are: each wraps only between
 * words, so no word or number is ever cut in two (the reflow sweep holds
 * every fixture's whole, and its value on one line, at 1024, 1280, 1440 and
 * 1460px, in each typeface).
 *
 * With `onSelect`, each tile is a toggle button (`aria-pressed`) that filters
 * by its subsystem, as the mock's do: a press calls `onSelect(key)`, or
 * `onSelect(null)` on the tile already `selected`, which shows an accent edge.
 * It is named "label, word, value", as a row is, and described by `sub`. A
 * tile drawn as no signal with another word (a stale status's last known
 * "Down", #480) names its lamp "No signal" (lampName), and says it before the
 * word: "Services, No signal, Down, 30 / 32", described "2 down".
 * Without `onSelect` the tiles are plain content.
 *
 * The `android` look, a stopgap until #326, is the Android app's grid of
 * cells, two to a row (lib/status.js), with its lamp rule (SubsystemCell,
 * below, which only the Android look draws): the same value over the same
 * sub-line, in the app's type.
 */
import { useId } from 'react';
import { StatusLamp } from './status-lamp.jsx';
import { StatusWord } from './status-word.jsx';
import { cn } from './lib/utils.js';
import { WORDS, lampName, spoken, toSeverity, toState } from './lib/status.js';

// A tint is a layer over the tile's surface-1: a gradient of one colour, which
// paints over the background colour and under the selected tile's inset ring.
// As a background colour of its own it sat over the frame's border colour in
// the gaps, a pairing no contrast check covers, and the text-3 label and line
// fell to 3.85:1 in light (the gallery's axe check, #289). Over surface-1 it
// is the pairing ui-contrast.mjs holds at 4.5:1.
const tint = {
  ok: '',
  warn: 'bg-linear-to-r from-warn-tint to-warn-tint',
  crit: 'bg-linear-to-r from-crit-tint to-crit-tint',
  unknown: 'bg-linear-to-r from-unknown-tint to-unknown-tint',
  maintenance: '',
};

// Columns by how many tiles there are, by the strip's own width (its
// `@container`). An empty slot would show the frame's `border-subtle`, so
// every row fills: six in rows of three, or of two, never 5 + 1; four two by
// two; five as 3 + 2 or 2 + 2 + 1, the last tile spanning the rest of its row
// below 672px. Six share a row only from 816px of strip (51rem, #541): there a
// tile has 102px for its value, and the widest value the model gives, "Low
// battery", is 100px in Montserrat at 16px bold (91 in Manrope, 94 in Plus
// Jakarta Sans; a count to "888 / 888" 83). Narrower, they keep the wide tile,
// value over sub-line, in rows of three. The reflow sweep proves it, in all
// three typefaces (e2e/reflow.spec.mjs).
const columns = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 @2xl:grid-cols-4',
  5: 'grid-cols-2 @xs:grid-cols-3 @2xl:grid-cols-5 @max-2xl:[&>:last-child]:col-span-2',
  6: 'grid-cols-2 @xs:grid-cols-3 @min-[51rem]:grid-cols-6',
};

/**
 * SubsystemCell — one cell of the Android app's strip. Its lamp:
 *   Power on battery (the model's crit or warn) → bolt; critical → slash;
 *   unknown → ring; maintenance → wrench; anything else → disc.
 */
function cellLampShape(key, severity) {
  if (key === 'power' && (severity === 'critical' || severity === 'caution')) return 'bolt';
  if (severity === 'critical') return 'slash';
  if (severity === 'unknown') return 'ring';
  if (severity === 'maintenance') return 'wrench';
  return 'disc';
}

function SubsystemCell({ cell }) {
  const severity = toSeverity(cell.state ?? cell.severity);
  return (
    <div className={`subsystem-cell subsystem-cell--${severity}`}>
      <div className="subsystem-cell__header">
        <span className="subsystem-cell__label">{cell.label}</span>
        <StatusLamp
          shape={cellLampShape(cell.key, severity)}
          severity={severity}
          label={`${cell.label}: ${cell.word}`}
          size={14}
        />
      </div>
      <StatusWord word={cell.word} severity={severity} />
      {/* The model's value over its sub-line (#541), as the web's tile draws them. */}
      <span className="subsystem-cell__value">{cell.value}</span>
      {cell.sub && <span className="subsystem-cell__sub">{cell.sub}</span>}
      {/* The Power cell's UPS readings the model doesn't carry (mobile board.js). */}
      {cell.readings && <span className="subsystem-cell__readings">{cell.readings}</span>}
    </div>
  );
}

function Tile({ cell, selected, onSelect }) {
  const id = useId();
  const s = toState(cell.state ?? cell.severity);
  const said = cell.word || WORDS[s];
  const named = lampName(s, said);
  const pressed = selected === cell.key;
  const Tag = onSelect ? 'button' : 'div';
  const action = onSelect
    ? {
        type: 'button',
        'aria-pressed': pressed,
        'aria-label': [cell.label, named !== said && named, spoken(said), cell.value]
          .filter(Boolean)
          .join(', '),
        'aria-describedby': cell.sub ? `${id}-sub` : undefined,
        onClick: () => onSelect(pressed ? null : cell.key),
      }
    : {};
  return (
    <Tag
      data-slot="subsystem-tile"
      data-state={s}
      className={cn(
        'flex min-w-0 flex-col gap-1 bg-surface-1 px-2.5 pt-2.5 pb-3 text-left text-text-1 @2xl:gap-1.5 @2xl:px-4 @2xl:pt-3.5 @2xl:pb-3.5',
        tint[s],
        // Under the pointer, surface-2 alone, tinted or not.
        onSelect &&
          'cursor-pointer -outline-offset-2 transition-colors hover:bg-surface-2 hover:bg-none',
        pressed && 'inset-ring-[1.5px] inset-ring-accent'
      )}
      {...action}
    >
      <span className="flex min-w-0 items-center gap-1.5 @2xl:gap-2">
        <StatusLamp state={s} label={named} />
        {/* Truncated with an ellipsis, after using 4px of the tile's padding: the
            mock's labels run a hair past their box, "Integrations" at 820px. */}
        <span className="-mr-1 truncate text-overline text-text-3 uppercase">{cell.label}</span>
      </span>
      {/* The model's short value over its sub-line (#541), each wrapping
          only between words: never a word or a number cut in two. */}
      <span data-slot="subsystem-value" className="text-body font-bold @2xl:text-title-sm">
        {cell.value}
      </span>
      {cell.sub && (
        <span
          id={`${id}-sub`}
          data-slot="subsystem-sub"
          className="hidden text-caption text-text-3 @2xl:block"
        >
          {cell.sub}
        </span>
      )}
    </Tag>
  );
}

function AndroidSubsystemStrip({ cells, 'aria-label': label }) {
  return (
    <div className="subsys-strip" role="list" aria-label={label ?? 'Subsystem health'}>
      {cells.map((c) => (
        <div key={c.key} role="listitem">
          <SubsystemCell cell={c} />
        </div>
      ))}
    </div>
  );
}

function SubsystemStrip(props) {
  if (__ANDROID_LOOK__) return <AndroidSubsystemStrip {...props} />;
  return <UiSubsystemStrip {...props} />;
}

function UiSubsystemStrip({
  cells,
  selected = null,
  onSelect,
  className,
  'aria-label': label,
  ...props
}) {
  return (
    <div className={cn('@container', className)} {...props}>
      <section
        data-slot="subsystem-strip"
        aria-label={label ?? 'Subsystems'}
        className={cn(
          'grid gap-px overflow-hidden rounded-xl border border-border-subtle bg-border-subtle',
          columns[Math.min(cells.length, 6)] ?? columns[6]
        )}
      >
        {cells.map((c) => (
          <Tile key={c.key} cell={c} selected={selected} onSelect={onSelect} />
        ))}
      </section>
    </div>
  );
}

export { SubsystemStrip, SubsystemCell };
