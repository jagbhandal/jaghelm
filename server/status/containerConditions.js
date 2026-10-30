// @ts-check
/**
 * The two container conditions fed by cAdvisor's event series (#764, spec §8):
 *
 *   restart_loop  more than RESTART_LOOP_LIMIT restarts in the last hour
 *   oom_kill      the kernel OOM-killed a process of the container in the last hour
 *
 * Both are counted from the same events the Monitoring page's restarts chart
 * draws (containerEvents.js, #761), so the banner, the chart and the push can
 * never disagree. They are issues of kind `container` with a `condition`, the
 * pair monitoringFocus.js maps to the `restarts` chart; they have no entity of
 * their own (the container's card stays "Running"), as a failed source has
 * none, so the Services tile's counts do not move.
 *
 * THE RESTART LIMIT: 3. It is Grafana's "Container Restart Loop" rule
 * (homelab-infra rule dfgwb2y4q6sjkd): `changes(container_start_time_seconds
 * [1h]) > 3`, "a container created more than 3 times in an hour". So a
 * container with 4 restarts in the last hour is in a loop; 3 is not (a
 * compose update plus two retries stays quiet). Grafana waited 5 minutes
 * (`for: 5m`) before it paged; JagHelm pages on the cycle that sees the 4th
 * restart, which the series' own minute step already delays.
 *
 * PER-CONTAINER LIMITS (#799): a container that restarts on purpose can have
 * its own limit in display-config.json's `restartLimits` (restartLimits.js),
 * keyed "node:container". pi-2's Vaultwarden standby is restarted by its sync
 * cron up to 4 times an hour, so its limit is 4 and it alerts at 5. The reason
 * says the limit that applied.
 *
 * HYSTERESIS: a loop that restarts every 15 minutes holds 4 or 5 restarts in
 * a sliding hour, so a plain `> 3` would open and close on nearly every
 * restart. Once open, a loop stays open while the hour holds 2 or more
 * restarts (`RESTART_LOOP_CLEAR_AT`), and clears when it holds 1 or none. The
 * memory of which loops are open is the model's (`held`, buildStatus), so it
 * starts empty after a JagHelm restart: a loop then re-enters only above the
 * limit again.
 *
 * The window ends at the read's own end (`endMs`), not at the model's clock:
 * the cached read can be a minute old, and its events would otherwise age out
 * of the hour early.
 *
 * The window is containerEvents.js' RESTART_LOOP_WINDOW_MS (1 h) for both.
 * Pure: no I/O.
 */
import { RESTART_LOOP_WINDOW_MS, restartLoops } from './restartLoops.js';

/** Restarts in the window above which a container is in a restart loop (Grafana's `> 3`). */
export const RESTART_LOOP_LIMIT = 3;

/** An open restart loop stays open while the hour holds at least this many restarts. */
export const RESTART_LOOP_CLEAR_AT = 2;

/**
 * Where an open loop clears, for a container with `limit`: the limit minus 2,
 * never below RESTART_LOOP_CLEAR_AT. The default limit (3) gives 2, as it
 * always did; a raised limit keeps the same 2-below gap (limit 6 clears below
 * 4), so a container that restarts more often by design does not open and
 * close on every restart either.
 */
export const clearAtFor = (/** @type {number} */ limit) => Math.max(RESTART_LOOP_CLEAR_AT, limit - 2);

/** The conditions, in the order they are listed. */

export const CONTAINER_CONDITIONS = Object.freeze(['restart_loop', 'oom_kill']);

/** The status word of each condition (summary.js says them in a sentence). */
export const CONDITION_WORDS = Object.freeze({
  restart_loop: 'Restart loop',
  oom_kill: 'OOM killed',
});

/** An issue's id: `containers/<node>:<container>:<condition>`. */
export const conditionIssueId = (
  /** @type {string} */ node,
  /** @type {string} */ name,
  /** @type {string} */ condition
) => `containers/${node}:${name}:${condition}`;

const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The container condition issues of an events read, or [] for a read that did
 * not run or did not answer (`read` not `ok`: cAdvisor not reporting is no
 * evidence of calm, and the push snapshot holds what it had, snapshot.js).
 *
 * @param {any} read  the `containerEvents` cache value (`readContainerEvents`' answer), or null
 * @param {{ now: number, limit?: number, limits?: Record<string, number>, held?: Set<string> }} opts
 *   limit: the default limit; limits: per "node:container" overrides (restartLimits.js)
 * @returns {any[]}  issues, restart loops then OOM kills, each by node and name
 */
export function containerConditionIssues(read, { now: clock, limit = RESTART_LOOP_LIMIT, limits = {}, held = new Set() }) {
  if (!read || typeof read !== 'object' || read.state !== 'ok' || !Array.isArray(read.events)) return [];
  const events = /** @type {{ time: number, kind: string, node: string, name: string, count?: number }[]} */ (
    read.events
  );
  // The window ends where the read did (see HYSTERESIS above).
  const now = Number.isFinite(read.endMs) && read.endMs <= clock ? read.endMs : clock;
  const issues = [];
  const since = (/** @type {string} */ kind, /** @type {string} */ node, /** @type {string} */ name) => {
    const times = events
      .filter(
        (e) =>
          e.kind === kind && e.node === node && e.name === name && e.time > now - RESTART_LOOP_WINDOW_MS && e.time <= now
      )
      .map((e) => e.time);
    return times.length ? Math.min(...times) : now;
  };
  // Every container with enough restarts to be held, then each judged by its own limit.
  const limitOf = (/** @type {string} */ node, /** @type {string} */ name) =>
    Object.hasOwn(limits, `${node}:${name}`) ? limits[`${node}:${name}`] : limit;
  const looping = restartLoops(events, { nowMs: now, limit: RESTART_LOOP_CLEAR_AT - 1 }).filter(
    (r) =>
      r.restarts > limitOf(r.node, r.name) ||
      (held.has(conditionIssueId(r.node, r.name, 'restart_loop')) &&
        r.restarts >= clearAtFor(limitOf(r.node, r.name)))
  );
  for (const { node, name, restarts } of looping) {
    const effective = limitOf(node, name);
    issues.push({
      id: conditionIssueId(node, name, 'restart_loop'),
      kind: 'container',
      condition: 'restart_loop',
      subsystem: 'services',
      name,
      node,
      state: 'warn',
      word: CONDITION_WORDS.restart_loop,
      reason: `Restart loop: ${plural(restarts, 'restart', 'restarts')} in the last hour (limit ${effective})`,
      since: since('restart', node, name),
    });
  }
  /** @type {Map<string, { node: string, name: string, kills: number }>} */
  const kills = new Map();
  for (const e of events) {
    if (e.kind !== 'oom' || e.time <= now - RESTART_LOOP_WINDOW_MS || e.time > now) continue;
    const key = `${e.node}\0${e.name}`;
    const row = kills.get(key) ?? { node: e.node, name: e.name, kills: 0 };
    row.kills += Number.isFinite(e.count) && /** @type {number} */ (e.count) > 0 ? /** @type {number} */ (e.count) : 1;
    kills.set(key, row);
  }
  for (const { node, name, kills: n } of [...kills.values()].sort(
    (a, b) => b.kills - a.kills || a.name.localeCompare(b.name)
  )) {
    issues.push({
      id: conditionIssueId(node, name, 'oom_kill'),
      kind: 'container',
      condition: 'oom_kill',
      subsystem: 'services',
      name,
      node,
      state: 'warn',
      word: CONDITION_WORDS.oom_kill,
      reason: `Out of memory: killed ${plural(n, 'time', 'times')} in the last hour`,
      since: since('oom', node, name),
    });
  }
  return issues;
}
