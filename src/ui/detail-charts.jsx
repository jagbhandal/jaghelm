/*
 * DetailCharts (spec §8, #311): an entity's history in its detail, under the
 * status box, as the mock's drawer draws it: "History" (`title`) as an overline heading
 * with the range switch beside it (a SegmentedControl named "Range": 1 h,
 * 24 h, 7 d), then each chart under its title in 12px text-2 (a node's
 * "Usage" and "Temperature"; "CPU" and "Memory" for containers), with a note
 * under one in 12px text-3 when a line of it had no answer. The screens build
 * what goes in (src/shell/historySeries.js); this only draws it.
 *
 * `charts` are each `{ key, title, label, series, domain, formatValue,
 * state, detail?, failedText?, note? }`, the Chart's props; `busy` while the
 * next range is read, so the last lines stay drawn, dimmed. `tickEvery`,
 * `formatTick` and `formatTime` are the range's.
 *
 * Its charts are one ChartGroup: they share one time axis, the widest value
 * label and line name setting the columns for all, so every plot starts at
 * the same x and is as wide, and the same range draws the same ticks.
 *
 * `size="touch"` (#602), for a phone's sheet (390px, one chart a row as
 * everywhere): the range switch's segments are 44px targets
 * (SegmentedControl's touch size); the charts are the drawer's.
 *
 * Its own module, apart from entity-detail.jsx, so the Chart rides only in
 * the chunk of the detail that draws it.
 */
import { useId } from 'react';
import { Chart, ChartGroup } from './chart.jsx';
import { SegmentedControl } from './segmented-control.jsx';
import { cn } from './lib/utils.js';

function DetailCharts({
  title = 'History',
  range,
  ranges = [],
  onRangeChange,
  charts = [],
  busy = false,
  tickEvery,
  formatTick,
  formatTime,
  size = 'md',
  className,
  ...props
}) {
  const id = useId();
  if (!charts.length) return null;
  return (
    <section
      data-slot="detail-charts"
      aria-labelledby={id}
      className={cn('flex min-w-0 flex-col gap-3', className)}
      {...props}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 id={id} className="text-overline text-text-3 uppercase">
          {title}
        </h3>
        <SegmentedControl
          aria-label="Range"
          size={size}
          options={ranges.map(({ value, label }) => ({ value, label }))}
          value={range}
          onValueChange={(value) => onRangeChange?.(value)}
        />
      </div>
      <ChartGroup className="gap-y-4">
        {charts.map((c) => (
          <div
            key={c.key}
            data-chart={c.key}
            className="col-span-full grid min-w-0 grid-cols-subgrid gap-y-1.5"
          >
            <h4 className="col-span-full text-caption font-semibold text-text-2">{c.title}</h4>
            <Chart
              label={c.label}
              series={c.series}
              domain={c.domain}
              formatValue={c.formatValue}
              state={c.state}
              detail={c.detail}
              failedText={c.failedText}
              legendNote={c.legendNote}
              busy={busy}
              tickEvery={tickEvery}
              formatTick={formatTick}
              formatTime={formatTime}
            />
            {c.note && (
              <p data-slot="detail-chart-note" className="col-span-full text-caption text-text-3">
                {c.note}
              </p>
            )}
          </div>
        ))}
      </ChartGroup>
    </section>
  );
}

export { DetailCharts };
