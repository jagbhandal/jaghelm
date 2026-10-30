// @ts-check
/**
 * Which Monitoring chart an issue of the status model opens (#752, spec §4):
 * the one table behind the banner's "View graph" links and the page's
 * `/monitoring?focus=<chart-id>`. Pure data and one pure function, apart from
 * monitoring.js (which reads Prometheus), so the web client's lazy chunk can
 * import it without the server's modules (as monitoringSections.js).
 *
 * `FOCUS` names the chart each kind of issue opens, by the id that chart has
 * in the server's table (MONITORING_CHARTS). The ids of charts a later card
 * builds are written here already: that card gives its chart this id and the
 * banner and the focus work without a line of their own. Until a chart has a
 * drawing (monitoring.js DRAWINGS) its issues are not banner rows, and a
 * focus on it draws nothing.
 *
 * What the model has no issue for yet (a restart loop, an OOM kill, a
 * container's memory growth, a disk's forecast; spec §8) is in the table and
 * not in `chartOfIssue`: that card adds its case beside the others.
 */

/** The query parameter that names the focused chart. */
export const FOCUS_PARAM = 'focus';

/** The registry of all nine chart ids (spec §5), which a kind of issue opens (spec §4's table). */
export const FOCUS = Object.freeze({
  power: 'power-draw',
  cost: 'monthly-cost',
  runway: 'disk-runway',
  cpu: 'cpu-overview',
  memory: 'memory',
  growth: 'container-growth',
  restarts: 'restarts',
  drives: 'drives',
  network: 'network',
});

/** The query parameter that names the issue the focus is for (optional). */
export const ISSUE_PARAM = 'issue';

/** The address of the page with chart `id` focused, for the status issue `issueId` if given. */
export const focusHref = (/** @type {string} */ id, /** @type {string} [issueId] */ issueId) =>
  `/monitoring?${FOCUS_PARAM}=${encodeURIComponent(id)}${
    issueId ? `&${ISSUE_PARAM}=${encodeURIComponent(issueId)}` : ''
  }`;

/** A node's reading, by the name the model gives it (`metric.name`), to its chart. */
const NODE_READING = Object.freeze({
  cpu: FOCUS.cpu,
  mem: FOCUS.memory,
  disk: FOCUS.runway,
  // The temperature is the CPU chart's drill-down.
  temp: FOCUS.cpu,
});

/**
 * The chart id the status model's issue `entity` opens, or null when none does
 * (a node that is down, a service, a source, a job: Alerts and the entity's
 * own detail are where those go).
 *
 * @param {any} entity  one of `status.issues`
 * @returns {string | null}
 */
export function chartOfIssue(entity) {
  if (!entity || typeof entity !== 'object') return null;
  // Only the UPS on battery (spec §4), not one with no signal.
  if (entity.kind === 'ups') return entity.state === 'unknown' ? null : FOCUS.power;
  if (entity.kind !== 'node') return null;
  const name = entity.metric?.name;
  if (typeof name === 'string') {
    if (name.startsWith('pool:')) return FOCUS.runway;
    if (Object.hasOwn(NODE_READING, name)) return NODE_READING[/** @type {'cpu'} */ (name)];
  }
  // No reading is what the node is amber or red for: a drive is.
  const drive = Array.isArray(entity.drives)
    ? entity.drives.some((/** @type {any} */ d) => d && d.state === entity.state)
    : false;
  return drive ? FOCUS.drives : null;
}
