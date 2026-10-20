/*
 * StatStrip (spec §5.4, §8; #288): a few neutral figures side by side, such as
 * a UPS's charge, runtime, load and input, or an integration's stats in the
 * detail drawer. It is the mock's one strip on the Overview, the subsystem
 * strip, without the status: tiles 1px apart inside one 12px-round frame, each
 * an overline label over the value (`title-sm` from 672px), with an optional
 * line under it and an optional `visual` (a Sparkline or a MetricMeter).
 *
 * `stats` is `[{ key, label, value, sub, visual }]`. Tiles are never tinted
 * and carry no lamp: a stat is not a state (SubsystemStrip and the status
 * components say those). Six sit in a row from 672px of the strip's own
 * container, three from 320px and two below, with the subsystem strip's
 * columns, so no row is left with an empty slot.
 *
 * It is a description list: each label is a term, its value and line its
 * details. A chart in a tile is a Sparkline, slot 1, so a meter beside it
 * never reads as one of its series (docs/design-system.md, "Data components").
 */
import { cn } from './lib/utils.js';

// SubsystemStrip's columns (stat-strip.test.jsx keeps the two the same). An
// empty slot would show the frame's `border-subtle`, so every row fills.
const columns = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 @2xl:grid-cols-4',
  5: 'grid-cols-2 @xs:grid-cols-3 @2xl:grid-cols-5 @max-2xl:[&>:last-child]:col-span-2',
  6: 'grid-cols-2 @xs:grid-cols-3 @2xl:grid-cols-6',
};

function StatStrip({ stats = [], className, ...props }) {
  return (
    <div className={cn('@container', className)} {...props}>
      <dl
        data-slot="stat-strip"
        className={cn(
          'grid gap-px overflow-hidden rounded-xl border border-border-subtle bg-border-subtle',
          columns[Math.min(stats.length, 6)] ?? columns[6]
        )}
      >
        {stats.map((s) => (
          <div
            key={s.key}
            data-slot="stat"
            className="flex min-w-0 flex-col gap-1 bg-surface-1 px-2.5 pt-2.5 pb-3 @2xl:gap-1.5 @2xl:px-4 @2xl:pt-3.5 @2xl:pb-3.5"
          >
            <dt className="truncate text-overline text-text-3 uppercase">{s.label}</dt>
            <dd className="text-body font-bold text-text-1 @2xl:text-title-sm">{s.value}</dd>
            {s.sub && <dd className="text-caption text-text-3">{s.sub}</dd>}
            {s.visual && <dd className="pt-1">{s.visual}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

export { StatStrip };
