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
 *  - `focus` (`{ node, tag }`, the page's) is how the banner's View graph (spec
 *    §4) points at a node: its cell takes the selected ring.
 */
import { ChartBody, ChartNote } from '@ui/chart-body';
import { EmptyState } from '@ui/empty-state';
import { SmallMultiples } from '@ui/small-multiples';
import { shownReading } from '../../server/status/readings.js';
import { pointsOf } from './historyLines.js';

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

/** The memory chart's Body (see the header): `({ chart, range, busy, focus, variant })`; `variant` 'phone' draws list rows (#755). */
export function MemoryBody({ chart, range, busy, focus, variant }) {
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
    return {
      key,
      name: key,
      slot: 0,
      seriesName: 'Memory',
      points: pointsOf(chart, key) ?? [],
      also: hasReading(swap) ? [{ key: `${key}-swap`, name: 'Swap', slot: 1, points: swap }] : [],
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
      {swapFailed && (
        <ChartNote data-slot="memory-swap-failed">
          {`Swap could not be read: ${chart.swap.error}. The memory lines are unaffected.`}
        </ChartNote>
      )}
    </ChartBody>
  );
}
