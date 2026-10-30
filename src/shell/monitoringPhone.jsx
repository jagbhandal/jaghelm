/**
 * How each chart of the Monitoring page is drawn on a phone (#755, spec §5, §7):
 * `PHONE_DRAWINGS`, pluggable the same way `DRAWINGS` is (monitoringDrawings.jsx).
 *
 *   PHONE_DRAWINGS[id] = { Body }
 *
 *   Body   a component, `({ chart, range, busy, focus }) => node`, the props of
 *          a DRAWINGS Body: what goes inside the chart's Panel on the phone's
 *          single column. A chart with no entry is not drawn here, and says so
 *          in a row of words (PhoneNotYet), never a blank Panel: it is drawn
 *          on a larger screen. The banner offers "View graph" only for the
 *          charts that have an entry, so a link never lands on that row.
 *
 * The cards that make the rest of the charts for a phone (#756 onward, D4 for
 * Resources, E4 for Containers and Drives) add their entries here. Today: the
 * two power charts and the disk runway are single-column and fluid, so the
 * desktop Body is the phone's; the CPU small multiples are
 * SmallMultiples' phone variant, a list of rows with a sparkline (rows open
 * the node's drill-down sheet). Memory (#759) is rows too, with swap's latest
 * figure said under memory's (a sparkline draws one line, so swap is in words)
 * and a sheet with both lines on a tap; network is one fluid chart.
 */
import { ChartNote } from '@ui/chart-body';
import { DRAWINGS } from './monitoringDrawings.jsx';

/** The desktop Body of chart `id`, for a chart whose single column is the phone's too. */
const same = (id) => Object.freeze({ Body: DRAWINGS[id].Body });

/** The desktop Body with SmallMultiples' phone variant: rows, not a grid. */
function rows(id) {
  const { Body } = DRAWINGS[id];
  function PhoneRows(props) {
    return <Body {...props} variant="phone" />;
  }
  return Object.freeze({ Body: PhoneRows });
}

export const PHONE_DRAWINGS = Object.freeze({
  'power-draw': same('power-draw'),
  'monthly-cost': same('monthly-cost'),
  'disk-runway': same('disk-runway'),
  'cpu-overview': rows('cpu-overview'),
  // Rows with swap said beside memory, each opening a sheet with both lines (#759).
  memory: rows('memory'),
  // One node's mirrored area in the column, a Select to pick the node (#759).
  network: same('network'),
});

/** The Body of a chart the phone does not draw yet: a plain row of words. */
export function PhoneNotYet() {
  return (
    <ChartNote data-slot="monitoring-phone-not-yet">
      This chart is not on the phone yet. Open Monitoring on a larger screen to see it.
    </ChartNote>
  );
}
