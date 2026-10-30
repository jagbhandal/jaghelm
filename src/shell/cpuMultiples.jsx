/**
 * The Monitoring page's CPU chart (#756, spec §5 chart 4, "Is a node's CPU
 * off?"): `cpu-overview` of GET /api/monitoring (server/monitoringCpu.js),
 * drawn as small multiples, a cell per visible node on one shared 0 to 100 %
 * axis with the warn line from the one threshold table, and on 7 d and 30 d
 * the max band behind each line (an average hides a spike). Its own module,
 * apart from monitoringDrawings.jsx, which only names it.
 *
 *  - A node that is off, or answered nothing in the range, has its cell and
 *    the cell says "No data"; a step it missed is a gap in the line, never 0.
 *    A note under the cells names such nodes in words.
 *  - A cell's name opens the drill-down: a Drawer with the node's I/O wait
 *    and its temperature (warn and crit lines), each with the max band on the
 *    long ranges. The server answers them with the cells, so opening one asks
 *    for nothing. A part Prometheus could not answer says so in its fixed
 *    sentence; a node with no sensor says so in words.
 *  - `focus` (`{ node, text?, drill?, tag }`, the page's: `tag` is the panel's
 *    own, drawn by MonitoringPage) is how the banner's View graph (spec §4)
 *    points at a node: its cell takes the selected ring and the tag
 *    (`text`, "Warning · 91 %"), and `drill` opens its drill-down (a
 *    temperature issue opens it, a CPU issue only marks the cell).
 */
import { useEffect, useState } from 'react';
import { ChartBody, ChartNote } from '@ui/chart-body';
import { Drawer } from '@ui/drawer';
import { DrillChart, DrillCharts } from '@ui/drill-chart';
import { EmptyState } from '@ui/empty-state';
import { SmallMultiples } from '@ui/small-multiples';
import { shownReading } from '../../server/status/readings.js';
import { pointsOf } from './historyLines.js';

const BAND = 'Highest in each step';

const percent = (v) => `${shownReading(v)} %`;
/** I/O wait is small: one decimal, so 0.4 % is not "0 %". */
const percentOne = (v) => `${(Math.round(v * 10) / 10).toFixed(1)} %`;
const degrees = (v) => `${shownReading(v)} °C`;

/**
 * A node's line of an answer part as the Chart's points, or null with none.
 * Every part is on the chart's grid (same start and step), which it holds.
 */
const pointsIn = (chart, part, node) =>
  part?.ok === false
    ? null
    : pointsOf({ ok: true, ...part, startMs: chart.startMs, stepMs: chart.stepMs }, node);

/** The node's max line as the Chart's band, or undefined (1 h and 24 h have none). */
function bandIn(chart, part, node) {
  const points = pointsIn(chart, { ...part, lines: part?.maxLines }, node);
  return points ? { name: BAND, points } : undefined;
}

/** The warn (and crit) lines of a reading as the Chart's reference lines. */
const refLines = (lines) =>
  ['warn', 'crit']
    .filter((level) => Number.isFinite(lines?.[level]))
    .map((level) => ({ level, value: lines[level], mark: true }));

/** The nodes the chart has a cell for: the server's list, else the lines it answered. */
const nodesOf = (chart) => {
  if (Array.isArray(chart.nodes)) return chart.nodes;
  return (Array.isArray(chart.lines) ? chart.lines : []).map((l) => l.entity);
};

/** One drill-down chart: its title, then the plot, or the words for why there is none. */
function DrillPart({ chartKey, title, node, range, chart, part, lines, format, domain, empty }) {
  const points = pointsIn(chart, part, node);
  const failed = part?.ok === false;
  const readings = points?.some((p) => p.value != null);
  return (
    <DrillChart
      name={chartKey}
      title={title}
      label={`${node} ${title}, ${range.words}`}
      series={readings ? [{ key: node, name: title, points }] : []}
      state={failed ? 'failed' : 'ready'}
      failedText={failed ? part.error : undefined}
      empty={empty}
      domain={domain}
      formatValue={format}
      thresholds={refLines(lines)}
      band={failed ? undefined : bandIn(chart, part, node)}
      height={120}
      tickEvery={range.tickEvery}
      formatTick={range.tick}
      formatTime={range.time}
    />
  );
}

/** The drill-down's body: the node's I/O wait and its temperature, on one time axis. */
export function CpuDrillDown({ chart, node, range }) {
  return (
    <DrillCharts>
      <DrillPart
        chartKey="iowait"
        title="I/O wait"
        node={node}
        range={range}
        chart={chart}
        part={chart.iowait}
        lines={{}}
        format={percentOne}
        domain="zero"
        empty={`No I/O wait reading for ${node} in this range.`}
      />
      <DrillPart
        chartKey="temperature"
        title="Temperature"
        node={node}
        range={range}
        chart={chart}
        part={chart.temperature}
        lines={chart.thresholds?.temp}
        format={degrees}
        domain="auto"
        empty={`No temperature reading for ${node} in this range. It may have no sensor, or be off.`}
      />
    </DrillCharts>
  );
}

/** The CPU chart's Body (see the header): `({ chart, range, busy, focus })`. */
export function CpuOverviewBody({ chart, range, busy, focus }) {
  const [drill, setDrill] = useState({ node: null, open: false });
  // A View graph that points at a node's temperature opens its drill-down.
  useEffect(() => {
    if (focus?.drill && focus.node) setDrill({ node: focus.node, open: true });
  }, [focus?.node, focus?.drill]);

  const ok = chart.ok === true;
  const nodes = ok ? nodesOf(chart) : [];
  const warn = chart.thresholds?.cpu?.warn;
  const cells = nodes.map((key) => ({
    key,
    name: key,
    points: pointsIn(chart, chart, key) ?? [],
    band: bandIn(chart, chart, key),
    highlighted: focus?.node === key ? (focus.text ?? true) : undefined,
  }));
  const off = cells.filter((c) => !c.points.some((p) => p.value != null)).map((c) => c.name);

  if (ok && nodes.length === 0) {
    return (
      <EmptyState
        data-slot="cpu-no-nodes"
        title="No nodes"
        description="No node is set up to show here."
      />
    );
  }
  return (
    <ChartBody busy={busy}>
      <SmallMultiples
        label={`${chart.title}, ${range.words}`}
        state={ok ? 'ready' : 'failed'}
        failedText={ok ? undefined : chart.error}
        cells={cells}
        domain={[0, 100]}
        thresholds={Number.isFinite(warn) ? refLines({ warn }) : undefined}
        formatValue={percent}
        tickEvery={range.tickEvery}
        formatTick={range.tick}
        formatTime={range.time}
        onOpen={(key) => setDrill({ node: key, open: true })}
      />
      {off.length > 0 && (
        <ChartNote data-slot="cpu-off-note">
          {`No CPU reading in this range from ${off.join(', ')}: the node may be off. A gap is shown as a gap, never as 0 %.`}
        </ChartNote>
      )}
      {ok && (
        <Drawer
          open={drill.open}
          onOpenChange={(open) => setDrill((d) => ({ ...d, open }))}
          eyebrow="CPU"
          title={drill.node ?? 'Node'}
          description={`I/O wait and temperature, ${range.words}`}
          data-drill="cpu"
        >
          {drill.node && <CpuDrillDown chart={chart} node={drill.node} range={range} />}
        </Drawer>
      )}
    </ChartBody>
  );
}
