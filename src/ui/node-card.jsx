/*
 * NodeCard (spec §5.4, §8 item 3; #299): one node of the Overview's
 * Infrastructure section, the mock's node card. Its name (15px bold) after the
 * user's colour for the node as a 10px swatch, the node's only colour (spec
 * §5.2); under it the host in mono and the node's subtitle, in 12px text-3.
 * At the right its state: the lamp alone when healthy (named by the word, so
 * healthy stays quiet), else the word in its state's colour beside the lamp.
 * A lamp drawn as no signal beside another word (a stale status's last known
 * "Healthy", #480) is named "No signal" (lampName), never by that word.
 *
 * Then a MetricMeter per reading, two to a row: violet below its line, a
 * status colour only at or over it, each given its lines and the server's
 * level by the caller (src/shell/infrastructureView.js), never judged here.
 * When the node isn't healthy, the model's reason in its state's colour.
 * Under a rule, the hosted services ("11 / 12 services up · 1 down") and the
 * uptime in 12px, and the last hour's trend as a Sparkline (96 × 24, slot 1),
 * when there is one.
 *
 * It is an article named by the node's name, so a page's anchor (`id`) can
 * focus it. With `onOpen` (the phone's Infrastructure, #303), its name is a
 * button that covers the whole card; with an `href` (the Overview's, the
 * node's URL, #309), a link that does, a plain click calling `onOpen` when it
 * has one (lib/link.js) and a modified one the browser's. A press anywhere on
 * the card opens the node, the focus ring stays on the name, and its meters
 * still read as meters. Its Sparkline is not decorative: it sits over the
 * name's cover, so Tab reaches it and its tooltip still opens.
 *
 * `readings` is `[{ key, label, value, unit, max, state, warn, crit, band }]`
 * (MetricMeter's props), `trend` is `{ points, label, formatValue }` or none,
 * and `services` and `uptime` are the footer's two lines.
 */
import { useId } from 'react';
import { MetricMeter } from './metric-meter.jsx';
import { Sparkline } from './sparkline.jsx';
import { StatusLamp } from './status-lamp.jsx';
import { StatusWord } from './status-word.jsx';
import { cn } from './lib/utils.js';
import { openHere } from './lib/link.js';
import { WORDS, lampName, toState } from './lib/status.js';

// The name that opens the node: it covers the card, so a press anywhere on it does.
const COVER =
  'min-w-0 cursor-pointer rounded-xs text-left wrap-anywhere after:absolute after:inset-0 after:rounded-xl after:transition-colors hover:after:bg-row-hover';

// The reason line in its state's word colour, as the mock's.
const said = {
  ok: 'text-text-2',
  warn: 'text-warn-fg',
  crit: 'text-crit-fg',
  unknown: 'text-unknown-fg',
  maintenance: 'text-maintenance-fg',
};

/** The user's colour for a node, as a 10px swatch beside its name (spec §5.2): never a status. */
function NodeSwatch({ colour, className }) {
  if (!colour) return null;
  return (
    <span
      data-slot="node-swatch"
      aria-hidden="true"
      className={cn('size-2.5 shrink-0 rounded-xs', className)}
      style={{ backgroundColor: colour }}
    />
  );
}

function NodeCard({
  name,
  host,
  subtitle,
  colour,
  state,
  word,
  reason,
  readings = [],
  services,
  uptime,
  trend,
  onOpen,
  href,
  className,
  ...props
}) {
  const id = useId();
  const opens = Boolean(onOpen || href);
  const s = toState(state);
  const spoken = word || WORDS[s];
  // A stale card keeps its last word ("Healthy"); its lamp is named by what it draws.
  const named = lampName(s, spoken);
  const quiet = s === 'ok';
  return (
    <article
      data-slot="node-card"
      data-state={s}
      aria-labelledby={`${id}-name`}
      className={cn(
        'flex h-full min-w-0 flex-col gap-3.5 rounded-xl border border-border bg-surface-1 p-4 text-text-1',
        opens && 'relative',
        className
      )}
      {...props}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 id={`${id}-name`} className="flex items-center gap-2 text-title-xs">
            <NodeSwatch colour={colour} />
            {href ? (
              <a
                href={href}
                onClick={onOpen ? (e) => openHere(e, onOpen) : undefined}
                className={COVER}
              >
                {name}
              </a>
            ) : onOpen ? (
              <button type="button" onClick={() => onOpen()} className={COVER}>
                {name}
              </button>
            ) : (
              <span className="min-w-0 wrap-anywhere">{name}</span>
            )}
          </h3>
          {(host || subtitle) && (
            <p className="text-caption wrap-anywhere text-text-3">
              {host && <span className="font-mono">{host}</span>}
              {host && subtitle ? ' · ' : null}
              {subtitle}
            </p>
          )}
        </div>
        <span data-slot="node-state" className="flex shrink-0 items-center gap-1.5 pt-0.5">
          {!quiet && <StatusWord state={s} word={spoken} className="text-caption" />}
          <StatusLamp state={s} label={named} decorative={!quiet && named === spoken} />
        </span>
      </div>
      {readings.length > 0 && (
        <div data-slot="node-meters" className="grid grid-cols-2 gap-x-4 gap-y-3">
          {readings.map((r) => (
            <MetricMeter
              key={r.key}
              data-reading={r.key}
              label={r.label}
              value={r.value}
              unit={r.unit}
              max={r.max}
              state={r.state ?? undefined}
              warn={r.warn}
              crit={r.crit}
              band={r.band}
            />
          ))}
        </div>
      )}
      {!quiet && reason && (
        <p data-slot="node-reason" className={cn('text-caption font-semibold', said[s])}>
          {reason}
        </p>
      )}
      <div
        data-slot="node-footer"
        className="mt-auto flex items-center gap-2.5 border-t border-border pt-3 text-caption text-text-3"
      >
        <div className="flex min-w-0 flex-1 flex-col">
          {services && <span className="text-text-2">{services}</span>}
          {uptime && <span>{uptime}</span>}
        </div>
        {trend && (
          <Sparkline
            points={trend.points}
            label={trend.label}
            formatValue={trend.formatValue}
            className={cn('shrink-0', opens && 'relative')}
          />
        )}
      </div>
    </article>
  );
}

export { NodeCard, NodeSwatch };
