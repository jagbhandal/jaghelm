/**
 * The Monitoring page's parts that are not drawing (#751, spec §5, §7): its
 * ranges, and how each chart of GET /api/monitoring (server/monitoring.js) is
 * drawn. Apart from MonitoringPage.jsx so tests can read them without the page.
 *
 * The server owns the chart table (a chart's id, title, question and section);
 * the client owns its drawing: `DRAWINGS` (monitoringDrawings.jsx, which says
 * the shape) maps a chart id to its section and the component that draws it. A chart the client
 * has no drawing for is not drawn (the server and the web are one build, so it
 * does not happen); monitoring.test.js holds the two tables in step.
 */
import { HISTORY_RANGES } from './historySeries.js';
import { dateTimeFormat } from '../util/format.js';

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

// How each chart is drawn (the shape is documented there; JSX, so its own file).
export { DRAWINGS } from './monitoringDrawings.jsx';
