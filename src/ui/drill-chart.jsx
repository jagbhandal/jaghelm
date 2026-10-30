/*
 * DrillCharts and DrillChart (#756): the charts in a drill-down sheet, such as
 * the Monitoring CPU cells' I/O wait and temperature. `DrillCharts` is a
 * ChartGroup (src/ui/chart.jsx): its charts share one time axis and the widest
 * value label, so every plot starts at the same x and is as wide. Each
 * `DrillChart` is a title (12px, text-2) over a Chart, with the Chart's own
 * props passed through (`label`, `series`, `domain`, `formatValue`,
 * `thresholds`, `band`, the range's ticks); `state="failed"` with
 * `failedText` is the Chart's failed message.
 *
 * `name` is the chart's key, kept on the element as `data-chart`.
 *
 * With `empty` (words) and no plot (`series` is empty and the state is
 * ready) it says why in place of the plot, in 14px text-2: a node with no
 * sensor, or off, never an empty plot that looks healthy.
 */
import { Chart, ChartGroup } from './chart.jsx';
import { cn } from './lib/utils.js';

function DrillCharts({ className, ...props }) {
  return <ChartGroup data-slot="drill-charts" className={cn('gap-y-4', className)} {...props} />;
}

function DrillChart({ name, title, empty, series = [], state = 'ready', className, ...props }) {
  const none = state === 'ready' && series.length === 0 && empty != null;
  return (
    <div
      data-slot="drill-chart"
      data-chart={name}
      className={cn('col-span-full grid min-w-0 grid-cols-subgrid gap-y-1.5', className)}
    >
      <h4 className="col-span-full text-caption font-semibold text-text-2">{title}</h4>
      {none ? (
        <p data-slot="drill-chart-empty" className="col-span-full m-0 text-body-sm text-text-2">
          {empty}
        </p>
      ) : (
        <Chart series={series} state={state} {...props} />
      )}
    </div>
  );
}

export { DrillChart, DrillCharts };
