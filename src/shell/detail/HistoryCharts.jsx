/**
 * The detail drawer's history (#311, spec §8): a node's or a container's
 * readings over the last hour, 24 hours or 7 days, from Prometheus through
 * GET /api/history (useHistory.js), drawn as DetailCharts (src/ui): a node's
 * "Usage" (CPU, memory and disk) and "Temperature", a container's "CPU" and
 * "Memory" (historySeries.js). The range starts at 1 h and stays as chosen
 * from one entity to the next while the drawer is open. EntityDrawer draws
 * it in EntityDetail's `chart` slot, for a view with a `chart` target
 * (entityDetail.js).
 */
import { useMemo, useState } from 'react';
import { DetailCharts } from '@ui/detail-charts';
import { HISTORY_RANGES, chartsOf, rangeOf } from '../historySeries.js';
import { useHistory } from './useHistory.js';

/**
 * @param {{ target: { kind: string, entity: string }, updated?: any }} props
 *   `updated`: the header's status poll (useStatus), whose answers pace the reads
 */
export function HistoryCharts({ target, updated }) {
  const [range, setRange] = useState(HISTORY_RANGES[0].value);
  const read = useHistory(target, range, updated);
  // What is drawn is the answer's range: the last one, while a switched one is read.
  const shown = rangeOf(read.range ?? range);
  const charts = useMemo(
    () => chartsOf(target, read.body, { range: shown.value, error: read.error }),
    [target, read.body, shown.value, read.error]
  );
  return (
    <DetailCharts
      range={range}
      ranges={HISTORY_RANGES}
      onRangeChange={setRange}
      charts={charts}
      busy={read.busy}
      tickEvery={shown.tickEvery}
      formatTick={shown.tick}
      formatTime={shown.time}
    />
  );
}
