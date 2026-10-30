/**
 * Chart 3 of the Monitoring page, Disk runway (#754, spec §5): which disk
 * fills first. Ranked bars of days left, one row per node (its fullest mount),
 * worst first as the server ranked them (server/monitoring.js diskRunwayOf);
 * below them the drill-in, a line of one node's disk filling with a dashed
 * projection to full.
 *
 * The client forecasts nothing. A bar is the server's `daysLeft`; the drill-in
 * is the same straight line the server fitted (`growthBytesPerDay`, over the
 * `samples` hours it fitted) run from the reading now (`usedBytes`) to the
 * size (`sizeBytes`), so it ends where `daysLeft` says. Only a row with a date
 * (`status: 'ok'`) has a bar or a projection. Every other status is said in
 * words and draws no bar, so a missing forecast is never a short bar and never
 * "plenty": `nodata` (a node that is off or not scraped) is "No signal",
 * `noisy` "Too irregular to forecast", `insufficient` "Not enough history",
 * and `stable` "Not filling" (or "Over a year" while it grows).
 */
import { useState } from 'react';
import { Chart } from '@ui/chart';
import { ChartBody, ChartNote, ChartToolbar } from '@ui/chart-body';
import { EmptyState } from '@ui/empty-state';
import { RankedBars } from '@ui/ranked-bars';
import { Select } from '@ui/select';
import { dateTimeFormat, formatDay } from '../util/format.js';
import { bytesText } from './backups.js';
import { daysLeftText } from './diskForecast.js';
import { DAY_MS, canProject, projectionOf, rowName, runwayRow } from './diskRunway.js';

const pctText = (v) => `${Math.round(v)} %`;
const monthDay = (ms) => formatDay(new Date(ms));
const tickOf = (ms) => dateTimeFormat({ month: 'short', day: 'numeric' }).format(new Date(ms));
const timeOf = (ms) => dateTimeFormat({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));

/** The drill-in for one node: the line, the dashed projection and a sentence under it. */
function Projection({ row, nowMs, label }) {
  const p = projectionOf(row, nowMs);
  const spanDays = (p.fullMs - p.startMs) / DAY_MS;
  const every = Math.max(1, Math.ceil(spanDays / 6)) * DAY_MS;
  const usedPct = Math.round((row.usedBytes / row.sizeBytes) * 1000) / 10;
  return (
    <>
      <Chart
        label={label}
        series={[
          { key: 'fitted', name: 'Trend over the last week', points: p.fitted },
          { key: 'projection', name: 'Projection to full', points: p.projection, dashed: true },
        ]}
        domain={[0, 100]}
        formatValue={pctText}
        tickEvery={every}
        formatTick={tickOf}
        formatTime={timeOf}
      />
      <ChartNote data-slot="runway-note">
        {`${rowName(row)} is ${usedPct} % full (${bytesText(row.usedBytes)} of ${bytesText(row.sizeBytes)}) and grows about ${bytesText(row.growthBytesPerDay)} a day. At that rate it is full around ${monthDay(p.fullMs)}. The dashed part is a projection, not a reading.`}
      </ChartNote>
    </>
  );
}

/** What goes in the Disk runway panel. */
export function DiskRunwayBody({ chart, busy }) {
  const [picked, setPicked] = useState(null);
  if (chart.ok !== true) {
    return (
      <RankedBars label="Disk runway, days until full" state="failed" failedText={chart.error} />
    );
  }
  const rows = Array.isArray(chart.rows) ? chart.rows : [];
  if (rows.length === 0) {
    return (
      <EmptyState
        data-slot="runway-empty"
        title="No disks to forecast"
        description="No node with a disk is set up, or none is visible."
      />
    );
  }
  const bars = rows.map((r) => runwayRow(r, chart.lines));
  const projectable = rows.filter(canProject);
  const chosen = projectable.find((r) => r.node === picked) ?? projectable[0] ?? null;
  const nowMs = Date.parse(chart.computedAt);
  const dated = Number.isFinite(nowMs);
  return (
    <ChartBody busy={busy}>
      <RankedBars
        label="Disk runway, days until full, soonest first"
        rows={bars}
        formatValue={(v) => daysLeftText(v)}
      />
      {chosen && dated ? (
        <>
          {projectable.length > 1 && (
            <ChartToolbar>
              <span id="runway-pick">Projection for</span>
              <Select
                aria-labelledby="runway-pick"
                items={projectable.map((r) => ({ value: r.node, label: rowName(r) }))}
                value={chosen.node}
                onValueChange={setPicked}
              />
            </ChartToolbar>
          )}
          <Projection row={chosen} nowMs={nowMs} label={`${rowName(chosen)}, disk filling, with a projection to full`} />
        </>
      ) : (
        <ChartNote data-slot="runway-no-projection">
          No disk has a date to project: a projection needs a steady fill over at least a day and a half.
        </ChartNote>
      )}
    </ChartBody>
  );
}
