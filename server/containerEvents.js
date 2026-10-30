// @ts-check
/**
 * Container restarts and OOM kills over a range (#761, spec §5 chart 7 and §8):
 * the series behind the Monitoring page's event strip, and the one place the
 * restart-loop signal (F1's alert condition) is counted from, so the chart and
 * the alert can never disagree.
 *
 * The source is cAdvisor through Prometheus, ported from the Grafana "Restarts
 * & OOMs" panel (homelab-infra, grafana/provisioning/dashboards/
 * homelab-containers.json), which is what the lab has trusted until now:
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

/** The kinds an event has: the strip's `restart` (a circle) and `oom` (a cross). */
export const EVENT_KINDS = Object.freeze(['restart', 'oom']);

/** The window the restart-loop condition counts restarts in (spec §8: "restarts in an hour"). */
export const RESTART_LOOP_WINDOW_MS = 3_600_000;

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
 * others have some; `oomCounter` whether cAdvisor exports the OOM counter.
 * Events are `{ time, kind, node, name, how?, count? }` with `node` the
 * services.yaml key, oldest first.
 *
 * @param {{ queryRange: (q: string, span: { start: number, end: number, step: number }) => Promise<any>, config: any, span: { start: number, end: number, step: number } }} args
 */
export async function readContainerEvents({ queryRange, config, span }) {
  const head = { startMs: span.start * 1000, endMs: span.end * 1000, stepMs: span.step * 1000 };
  const target = resolveEntity({ kind: 'node', entity: null }, config);
  if (!target.ok || !target.matcher) {
    return { state: 'no-containers', ...head, events: [], truncated: false, blindNodes: [], oomCounter: false };
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
    return { state: 'no-containers', ...head, events: [], truncated: false, blindNodes: [], oomCounter: false };
  }
  const blindNodes = (target.keys ?? []).filter(
    (key) => ![...seen].some((label) => target.lineOf?.({ node: label })?.includes(key))
  );
  const all = eventsOf({ recreated, reset, oom }, head.stepMs).map((e) => ({ ...e, node: keyOf(e.node) }));
  const truncated = all.length > MAX_EVENTS;
  return {
    state: 'ok',
    ...head,
    events: truncated ? all.slice(-MAX_EVENTS) : all,
    truncated,
    blindNodes,
    oomCounter: (Array.isArray(counter) ? counter : []).some((r) => (r?.values ?? []).length > 0),
  };
}

/**
 * The restart-loop signal (spec §8): containers with more than `limit`
 * restarts in the `windowMs` ending at `nowMs`, most first. This is what the
 * alert condition counts, from the same events the chart draws. OOM kills are
 * not restarts here (they have their own condition).
 *
 * @param {{ time: number, kind: string, node: string, name: string }[]} events
 * @param {{ nowMs: number, limit: number, windowMs?: number }} opts
 * @returns {{ node: string, name: string, restarts: number }[]}
 */
export function restartLoops(events, { nowMs, limit, windowMs = RESTART_LOOP_WINDOW_MS }) {
  const counts = new Map();
  for (const e of events) {
    if (e.kind !== 'restart' || e.time <= nowMs - windowMs || e.time > nowMs) continue;
    const key = `${e.node}\0${e.name}`;
    const row = counts.get(key) ?? { node: e.node, name: e.name, restarts: 0 };
    row.restarts += 1;
    counts.set(key, row);
  }
  return [...counts.values()]
    .filter((r) => r.restarts > limit)
    .sort((a, b) => b.restarts - a.restarts || a.name.localeCompare(b.name));
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
