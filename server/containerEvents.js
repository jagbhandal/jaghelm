// @ts-check
/**
 * Container restarts and OOM kills over a range (#761, spec §5 chart 7 and §8):
 * the series behind the Monitoring page's event strip, and the one place the
 * restart-loop signal (F1's alert condition) is counted from, so the chart and
 * the alert can never disagree.
 *
 * The source is cAdvisor through Prometheus, the "Restarts & OOMs"
 * queries below:
 *
 *   - RECREATED: `time() - container_start_time_seconds` below one step. That
 *     metric is the container's CREATION time, so it moves when a container is
 *     recreated (a compose `up`, an update, a crash with a new container), and
 *     it gives the creation time itself (the evaluation time minus the age).
 *   - RESTARTED: the container's CPU counter lower than it was a minute ago
 *     (`container_cpu_usage_seconds_total < bool ... offset 1m`) at any point
 *     of the step. This sees a `docker restart`, whose container keeps its
 *     creation time. The time is the step it was seen in.
 *   - OOM: `increase(container_oom_events_total[step]) > 0`, the kernel's OOM
 *     kills of a process in the container's cgroup.
 *
 * WHAT IT CANNOT SEE (said on the chart): a restart that leaves neither a new
 * creation time nor a CPU counter that goes backwards (a container that was
 * stopped and started inside one scrape, whose new counter has already passed
 * the old one by the next sample); a host or cAdvisor that was down (no series
 * is a gap, not "no restarts": `blindNodes` names the nodes with no container
 * readings in the range); an OOM kill when cAdvisor exports no OOM counter
 * (`oomCounter` false). Times are to the nearest step: a minute on 1 h, two
 * hours on 30 d. Arcane's helper containers and CI job containers are not
 * services (helperContainers.js) and are left out, as discovery leaves them.
 */
import { NOT_HELPER, NOT_JOB } from './util/helperContainers.js';
import { resolveEntity } from './promHistory.js';
import { RESTART_LOOP_WINDOW_MS, restartLoops } from './status/restartLoops.js';

// Re-exported: the pure counting lives in status/restartLoops.js (the client bundle
// imports the status model, so that file must not reach promHistory.js and node builtins).
export { RESTART_LOOP_WINDOW_MS, restartLoops };

/** The kinds an event has: the strip's `restart` (a circle) and `oom` (a cross). */
export const EVENT_KINDS = Object.freeze(['restart', 'oom']);

/** How long a node may go without a container reading before it is silent (#838). */
export const SILENT_AFTER_MS = 4 * 60_000;

/** Node keys that never page for missing container readings (#838). */
const NEVER_PAGES = new Set(['vm101']);

/** Events an answer carries at most; the most recent are kept, `truncated` says so. */
export const MAX_EVENTS = 400;

/** `how` a restart was seen, which the strip's tooltip says. */
const HOW = Object.freeze({
  recreated: 'container recreated',
  reset: 'process restarted',
});

/**
 * The three queries and the two presence checks, for a node matcher and a step in seconds.
 *
 * @param {string} matcher
 * @param {number} step
 */
export function eventQueries(matcher, step) {
  const sel = `${matcher},name!="",${NOT_HELPER},${NOT_JOB}`;
  const cpu = `container_cpu_usage_seconds_total{${sel}}`;
  return {
    recreated: `max by (node, name) ((time() - container_start_time_seconds{${sel}}) < ${step})`,
    reset: `max by (node, name) (max_over_time((${cpu} < bool ${cpu} offset 1m)[${step}s:1m]) > 0)`,
    oom: `sum by (node, name) (increase(container_oom_events_total{${sel}}[${step}s])) > 0`,
    containers: `count by (node) (container_start_time_seconds{${sel}})`,
    oomCounter: `count(container_oom_events_total{${sel}})`,
  };
}

const finite = (/** @type {unknown} */ v) => {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Each point of a matrix as `{ node, name, at, value }` (`at` in ms): the
 * evaluation time and its value, for the points whose value is a number.
 */
function pointsOf(/** @type {any} */ matrix, { named = true } = {}) {
  const out = [];
  for (const r of Array.isArray(matrix) ? matrix : []) {
    const node = r?.metric?.node;
    const name = named ? r?.metric?.name : '';
    if (typeof node !== 'string' || typeof name !== 'string') continue;
    for (const [ts, raw] of Array.isArray(r.values) ? r.values : []) {
      const value = finite(raw);
      const at = finite(ts);
      if (value !== null && at !== null) out.push({ node, name, at: at * 1000, value });
    }
  }
  return out;
}

/**
 * The events in the three matrices, oldest first. A restart seen both as a
 * recreation and as a counter reset within one step of each other is one event
 * (the recreation's, which has the exact time). `stepMs` is the grid's step.
 *
 * @param {{ recreated?: any, reset?: any, oom?: any }} matrices
 * @param {number} stepMs
 * @returns {{ time: number, kind: 'restart' | 'oom', node: string, name: string, how?: string, count?: number }[]}
 */
export function eventsOf({ recreated, reset, oom }, stepMs) {
  /** @type {any[]} */
  const events = [];
  const created = new Map(); // `${node}\0${name}` -> times, for the de-duplication
  for (const p of pointsOf(recreated)) {
    // The age is how long ago it was created; the time is when, not when it was seen.
    const time = Math.round(p.at - p.value * 1000);
    events.push({ time, kind: 'restart', node: p.node, name: p.name, how: HOW.recreated });
    const key = `${p.node}\0${p.name}`;
    created.set(key, [...(created.get(key) ?? []), time]);
  }
  for (const p of pointsOf(reset)) {
    const near = created.get(`${p.node}\0${p.name}`) ?? [];
    if (near.some((/** @type {number} */ t) => Math.abs(t - p.at) < stepMs * 1.5)) continue;
    events.push({ time: p.at, kind: 'restart', node: p.node, name: p.name, how: HOW.reset });
  }
  for (const p of pointsOf(oom)) {
    if (p.value > 0) {
      events.push({ time: p.at, kind: 'oom', node: p.node, name: p.name, count: Math.round(p.value) });
    }
  }
  return events.sort(
    (a, b) => a.time - b.time || a.node.localeCompare(b.node) || a.name.localeCompare(b.name)
  );
}

/**
 * Read the events of `span` ({ start, end, step } in seconds) for every visible
 * node. Throws when a query fails (the cache words it): a failed read is a
 * failed chart, never "no restarts".
 *
 * Answers `{ state, startMs, endMs, stepMs, events, truncated, blindNodes,
 * oomCounter }`. `state` is 'ok' or 'no-containers' (no container reading at
 * all in the range: cAdvisor is not reporting, which is not "nothing restarted").
 * `blindNodes` are the node keys with no container reading in the range, when
 * others have some; `silentNodes` (#838) those that read earlier in the range
 * but not for SILENT_AFTER_MS, the signal the push pages on (status/containerBlind.js;
 * `silentGap` when all of them are, a gap in the read, which names none);
 * `oomCounter` whether cAdvisor exports the OOM counter.
 * Events are `{ time, kind, node, name, how?, count? }` with `node` the
 * services.yaml key, oldest first.
 *
 * @param {{ queryRange: (q: string, span: { start: number, end: number, step: number }) => Promise<any>, config: any, span: { start: number, end: number, step: number } }} args
 */
export async function readContainerEvents({ queryRange, config, span }) {
  const head = { startMs: span.start * 1000, endMs: span.end * 1000, stepMs: span.step * 1000 };
  const target = resolveEntity({ kind: 'node', entity: null }, config);
  if (!target.ok || !target.matcher) {
    return { state: 'no-containers', ...head, events: [], truncated: false, blindNodes: [], silentNodes: [], silentGap: false, oomCounter: false };
  }
  const grid = { start: span.start, end: span.end, step: span.step };
  const q = eventQueries(target.matcher, span.step);
  const [recreated, reset, oom, containers, counter] = await Promise.all([
    queryRange(q.recreated, grid),
    queryRange(q.reset, grid),
    queryRange(q.oom, grid),
    queryRange(q.containers, grid),
    queryRange(q.oomCounter, grid),
  ]);
  // A node has container readings if a series of it has a point in the range.
  const seen = new Set(pointsOf(containers, { named: false }).map((p) => p.node));
  const keyOf = (/** @type {string} */ label) => target.lineOf?.({ node: label })?.[0] ?? label;
  if (seen.size === 0) {
    return { state: 'no-containers', ...head, events: [], truncated: false, blindNodes: [], silentNodes: [], silentGap: false, oomCounter: false };
  }
  const blindNodes = (target.keys ?? []).filter(
    (key) => ![...seen].some((label) => target.lineOf?.({ node: label })?.includes(key))
  );
  // A node that read earlier in the range but not lately (#838): cAdvisor stopped
  // reporting for it. A failed scrape makes Prometheus mark the series stale at once, so
  // a node is missing from the newest grid point for the 30 s until the next scrape; the
  // status loop (30 s cycles) would count one such read as two failed cycles. So a node is
  // silent only after SILENT_AFTER_MS without a reading, whatever the cycles do, and the
  // page lands about five minutes after cAdvisor goes (this window, then two cycles).
  // That is minutes, not the range's hour that blindNodes waits.
  const lastAt = new Map();
  for (const p of pointsOf(containers, { named: false })) lastAt.set(p.node, Math.max(lastAt.get(p.node) ?? 0, p.at));
  const silentSince = head.endMs - Math.max(SILENT_AFTER_MS, head.stepMs);
  // Nodes that read in the range and may page. vm-101 is scraped (cadvisor-vm101) but is
  // not covered by design (#838): a gap there is not a page, and it does not count below.
  const covered = (target.keys ?? []).filter(
    (key) => !NEVER_PAGES.has(key) && [...seen].some((label) => target.lineOf?.({ node: label })?.includes(key))
  );
  const quiet = covered.filter((key) => {
    const labels = [...seen].filter((label) => target.lineOf?.({ node: label })?.includes(key));
    return Math.max(...labels.map((l) => lastAt.get(l) ?? 0)) <= silentSince;
  });
  // Every node that read is now silent: that is Prometheus (or the path to it) having been
  // away, not every cAdvisor stopping at once. The read cannot say, so it names none and
  // `silentGap` tells the push to hold what it has.
  const silentGap = quiet.length > 0 && quiet.length === covered.length;
  const silentNodes = silentGap ? [] : quiet;
  const all = eventsOf({ recreated, reset, oom }, head.stepMs).map((e) => ({ ...e, node: keyOf(e.node) }));
  const truncated = all.length > MAX_EVENTS;
  return {
    state: 'ok',
    ...head,
    events: truncated ? all.slice(-MAX_EVENTS) : all,
    truncated,
    blindNodes,
    silentNodes,
    silentGap,
    oomCounter: (Array.isArray(counter) ? counter : []).some((r) => (r?.values ?? []).length > 0),
  };
}

/** How often the status loop reads the last hour of events: the series' step (#764). */
export const CONTAINER_EVENTS_EVERY_MS = 60_000;

/**
 * The last hour of events at the series' one-minute step, for the status
 * loop's restart-loop and OOM conditions (refresh.js refreshContainerEvents,
 * status/containerConditions.js): the same read and the same counting as the
 * Monitoring page's 1 h chart.
 *
 * @param {{ queryRange: Parameters<typeof readContainerEvents>[0]['queryRange'], config: any, now?: number }} args
 */
export function readRecentContainerEvents({ queryRange, config, now = Date.now() }) {
  const end = Math.floor(now / 1000);
  return readContainerEvents({
    queryRange,
    config,
    span: { start: end - RESTART_LOOP_WINDOW_MS / 1000, end, step: 60 },
  });
}
