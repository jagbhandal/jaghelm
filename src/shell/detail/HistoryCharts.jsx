/**
 * The detail drawer's history (#311, spec §8): a node's or a container's
 * readings over the last hour, 24 hours or 7 days, from Prometheus through
 * GET /api/history (useHistory.js), drawn as DetailCharts (src/ui): a node's
 * "Usage" (CPU, memory and disk) and "Temperature", a container's "CPU" and
 * "Memory" (historySeries.js). The range starts at 1 h and stays as chosen
 * from one entity to the next while the drawer is open. EntityDrawer draws
 * it in EntityDetail's `chart` slot, for a view with a `chart` target
 * (entityDetail.js).
 *
 * The phone's sheet draws the same (#602): the web's (PhoneDetail.jsx) and
 * the Android app's (mobile/src/components/DetailHistory.jsx), at `size`
 * "touch" (the range switch's segments 44px targets), `paused` while another
 * sheet covers it. From a server older than #311 (useHistory's `old`), it
 * draws nothing at all, not an error.
 */
import { useMemo, useState } from 'react';
import { DetailCharts } from '@ui/detail-charts';
import { HISTORY_RANGES, chartsOf, rangeOf } from '../historySeries.js';
import { useHistory } from './useHistory.js';

/**
 * @param {{ target: { kind: string, entity: string }, updated?: any, size?: 'md' | 'touch',
 *   paused?: boolean }} props
 *   `updated`: the header's status poll (useStatus), whose answers pace the reads
 */
export function HistoryCharts({ target, updated, size = 'md', paused = false }) {
  const [range, setRange] = useState(HISTORY_RANGES[0].value);
  const read = useHistory(target, range, updated, { paused });
  // What is drawn is the answer's range: the last one, while a switched one is read.
  const shown = rangeOf(read.range ?? range);
  const charts = useMemo(
    () => chartsOf(target, read.body, { range: shown.value, error: read.error }),
    [target, read.body, shown.value, read.error]
  );
  if (read.old) return null;
  return (
    <DetailCharts
      size={size}
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
