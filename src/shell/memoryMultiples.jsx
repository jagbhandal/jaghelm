/**
 * The Monitoring page's memory chart (#757, spec §5 chart 5, "Is memory or swap
 * under strain?"): `memory` of GET /api/monitoring (server/monitoringMemory.js),
 * drawn as small multiples, a cell per visible node with two lines on one
 * shared 0 to 100 % axis, memory in use and swap in use, and the memory warn
 * line from the one threshold table. Its own module, apart from
 * monitoringDrawings.jsx, which only names it.
 *
 *  - A node that is off, or answered nothing in the range, has its cell and the
 *    cell says "No data"; a step it missed is a gap, never 0. A note under the
 *    cells names such nodes in words.
 *  - A node with no swap has the memory line alone, and a note names it: the
 *    absence of a line is said, never drawn as a flat 0 % that reads healthy.
 *  - A failed swap read says its fixed sentence under the cells and leaves the
 *    memory lines as they are.
 *  - On a phone (`variant="phone"`, #759) each cell is a row: memory's latest
 *    figure and sparkline, and under it swap's latest figure in words ("Swap
 *    12 %", "No swap", "Swap could not be read"), so swap is never hidden by
 *    a sparkline that draws one line. A row opens a sheet with the full chart,
 *    memory and swap on the shared 0 to 100 % axis with the warn line.
 *  - `focus` (`{ node, tag }`, the page's) is how the banner's View graph (spec
 *    §4) points at a node: its cell takes the selected ring, and on a phone
 *    (`drill`, #807) its sheet opens, as a temperature issue opens CPU's.
 */
import { Chart } from '@ui/chart';
import { ChartBody, ChartNote } from '@ui/chart-body';
import { EmptyState } from '@ui/empty-state';
import { SmallMultiples } from '@ui/small-multiples';
import { shownReading } from '../../server/status/readings.js';
import { pointsOf } from './historyLines.js';
import { useDrillSheet } from './drillSheet.js';
import DrillSheet from '../phone/components/DrillSheet.jsx';

const percent = (v) => `${shownReading(v)} %`;

const hasReading = (points) => Boolean(points?.some((p) => p.value != null));

/** "Edge", "Edge and Apps", "Edge, Apps and Lab": names in a sentence. */
const listed = (names) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** The nodes the chart has a cell for: the server's list, else the lines it answered. */
const nodesOf = (chart) => {
  if (Array.isArray(chart.nodes)) return chart.nodes;
  return (Array.isArray(chart.lines) ? chart.lines : []).map((l) => l.entity);
};

/** Swap's newest reading in words, for a phone row: a missing one is said, never 0 %. */
function swapAside(swapFailed, also) {
  if (swapFailed) return 'Swap could not be read';
  if (!also.length) return 'No swap';
  const last = also[0].points.at(-1)?.value;
  return last == null ? 'No swap reading now' : `Swap ${percent(last)}`;
}

/** The sheet's full chart of one node: memory and swap, 0 to 100 %. */
function MemoryDrill({ cell, range, warn }) {
  const series = [
    { key: cell.key, name: 'Memory', points: cell.points },
    ...cell.also.map((a) => ({ key: a.key, name: a.name, points: a.points })),
  ];
  return (
    <Chart
      label={`${cell.name} memory and swap, ${range.words}`}
      series={series}
      domain={[0, 100]}
      formatValue={percent}
      thresholds={Number.isFinite(warn) ? [{ level: 'warn', value: warn, mark: true }] : undefined}
      height={160}
      tickEvery={range.tickEvery}
      formatTick={range.tick}
      formatTime={range.time}
    />
  );
}

/** The memory chart's Body (see the header): `({ chart, range, busy, focus, variant })`; `variant` 'phone' draws list rows (#755). */
export function MemoryBody({ chart, range, busy, focus, variant }) {
  // The sheet is a history entry of its own (#833, drillSheet.js): Back closes it and
  // focus returns to the node's row. A View graph that points at a node opens its sheet
  // (phone only: the wide page has none), only for a node the chart has a cell for:
  // otherwise the sheet would open empty.
  const sheet = useDrillSheet('memory', {
    enabled: variant === 'phone',
    focus,
    known: (node) => chart.ok === true && nodesOf(chart).includes(node),
  });

  const ok = chart.ok === true;
  const nodes = ok ? nodesOf(chart) : [];
  const swapFailed = ok && chart.swap?.ok === false;
  const warn = chart.thresholds?.mem?.warn;
  const swapOf = (key) =>
    swapFailed
      ? null
      : pointsOf({ ok: true, ...chart.swap, startMs: chart.startMs, stepMs: chart.stepMs }, key);
  const cells = nodes.map((key) => {
    const swap = swapOf(key);
    const also = hasReading(swap) ? [{ key: `${key}-swap`, name: 'Swap', slot: 1, points: swap }] : [];
    return {
      key,
      name: key,
      slot: 0,
      seriesName: 'Memory',
      points: pointsOf(chart, key) ?? [],
      also,
      aside: variant === 'phone' && hasReading(pointsOf(chart, key)) ? swapAside(swapFailed, also) : undefined,
      highlighted: focus?.node === key ? (focus.text ?? true) : undefined,
    };
  });
  const off = cells.filter((c) => !hasReading(c.points)).map((c) => c.name);
  const noSwap = swapFailed
    ? []
    : cells.filter((c) => hasReading(c.points) && c.also.length === 0).map((c) => c.name);

  if (ok && nodes.length === 0) {
    return (
      <EmptyState
        data-slot="memory-no-nodes"
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
        thresholds={
          Number.isFinite(warn) ? [{ level: 'warn', value: warn, mark: true }] : undefined
        }
        formatValue={percent}
        tickEvery={range.tickEvery}
        formatTick={range.tick}
        formatTime={range.time}
        variant={variant}
        onOpen={variant === 'phone' ? sheet.open : undefined}
        data-rows="memory"
      />
      {ok && (
        <ChartNote data-slot="memory-legend">
          Memory and swap are each the share in use of their own total.
        </ChartNote>
      )}
      {off.length > 0 && (
        <ChartNote data-slot="memory-off-note">
          {`No memory reading in this range from ${listed(off)}: the node may be off. A gap is shown as a gap, never as 0 %.`}
        </ChartNote>
      )}
      {noSwap.length > 0 && (
        <ChartNote data-slot="memory-no-swap-note">
          {`${listed(noSwap)} ${noSwap.length === 1 ? 'has' : 'have'} no swap, so no swap line.`}
        </ChartNote>
      )}
      {variant === 'phone' && ok && sheet.node && cells.find((c) => c.key === sheet.node) && (
        <DrillSheet
          drill="memory"
          eyebrow="Memory"
          title={sheet.node}
          description={`Memory and swap in use, ${range.words}`}
          onClose={sheet.close}
        >
          <MemoryDrill cell={cells.find((c) => c.key === sheet.node)} range={range} warn={warn} />
        </DrillSheet>
      )}
      {swapFailed && (
        <ChartNote data-slot="memory-swap-failed">
          {`Swap could not be read: ${chart.swap.error}. The memory lines are unaffected.`}
        </ChartNote>
      )}
    </ChartBody>
  );
}
