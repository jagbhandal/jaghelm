/**
 * The Monitoring page's parts that are not drawing (#751, spec §5, §7): its
 * ranges, and how each chart of GET /api/monitoring (server/monitoring.js) is
 * drawn. Apart from MonitoringPage.jsx so tests can read them without the page.
 *
 * The server owns the chart table (a chart's id, title, question and section);
 * the client owns its drawing: `DRAWINGS` maps a chart id to its section and a
 * function from the server's chart to the Chart's props. A chart the client
 * has no drawing for is not drawn (the server and the web are one build, so it
 * does not happen); monitoring.test.js holds the two tables in step.
 */
import { HISTORY_RANGES } from './historySeries.js';
import { pointsOf } from './historyLines.js';
import { shownReading } from '../../server/status/readings.js';
import { dateTimeFormat } from '../util/format.js';
import { MAX_SERIES } from '../ui/chart.jsx';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const date = { weekday: 'short', day: 'numeric' };
const dateHm = {
  weekday: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};

/**
 * The ranges the page's switch offers: the drawer's three, and 30 days (#745,
 * Prometheus's retention, a point every 2 hours). The same shape as
 * historySeries.js' HISTORY_RANGES: `value`, `label`, `words`, `tickEvery`,
 * `tick`, `time` and `stepMs`.
 */
export const MONITORING_RANGES = Object.freeze([
  ...HISTORY_RANGES,
  Object.freeze({
    value: '30d',
    label: '30 d',
    words: 'last 30 days',
    tickEvery: 5 * DAY,
    tick: (t) => dateTimeFormat(date).format(new Date(t)),
    time: (t) => dateTimeFormat(dateHm).format(new Date(t)),
    stepMs: 2 * HOUR,
  }),
]);

export const monitoringRangeOf = (value) =>
  MONITORING_RANGES.find((r) => r.value === value) ?? MONITORING_RANGES[0];

/**
 * A line chart of one line per node, by the node's key, in the order the
 * server gave them (services.yaml's), one chart slot each. More than the
 * chart's six are said in a note, not drawn.
 */
function perNodeLines(chart, format, domain) {
  const lines = (Array.isArray(chart.lines) ? chart.lines : []).filter(
    (l) => typeof l?.entity === 'string'
  );
  const drawn = lines.slice(0, MAX_SERIES);
  return {
    series: drawn.map((l) => ({
      key: l.entity,
      name: l.entity,
      points: pointsOf(chart, l.entity),
    })),
    domain,
    formatValue: format,
    legendNote:
      lines.length > drawn.length ? `+${lines.length - drawn.length} more nodes, not drawn` : null,
  };
}

/**
 * Each chart the page can draw: its `section` (server/monitoringSections.js)
 * and `props(chart)`, the Chart's props for an answered chart (series, domain,
 * formatValue, legendNote). A failed chart needs none.
 */
export const DRAWINGS = Object.freeze({
  'cpu-overview': Object.freeze({
    section: 'resources',
    props: (chart) => perNodeLines(chart, (v) => `${shownReading(v)} %`, [0, 100]),
  }),
});
