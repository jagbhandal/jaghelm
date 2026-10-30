// @ts-check
/**
 * The restart-loop count, kept free of imports. server/status/model.js is
 * bundled into the browser (the gallery and the phone share it), so nothing it
 * imports may reach a node builtin; containerEvents.js pulls in promHistory.js
 * (fs, path, ...) and so cannot be imported from there. containerEvents.js
 * re-exports these, so server code keeps one name for them.
 */

/** The window the restart-loop condition counts restarts in (spec §8: "restarts in an hour"). */
export const RESTART_LOOP_WINDOW_MS = 3_600_000;

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
