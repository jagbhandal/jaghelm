/**
 * The jobs a Remove took off in this tab (#578), until the status model drops
 * them. Remove deletes the job and its history at once (DELETE
 * /api/cron/jobs/:node/:job), but the model reads the cron store once a
 * cycle, so the job stays in /api/status until the next one: its row goes at
 * once anyway. A removed job is left out of the lists
 *
 *  - until the model no longer has it, then forgotten, so a job that reports
 *    again later is listed again ("It comes back the next time it reports");
 *  - unless it reported again since (a later `lastRun`), when it is listed
 *    at once;
 *  - for the rest of the visit on a read-only server (the public demo,
 *    #248), which keeps the Remove in this tab only (useData.js
 *    deleteCronJob): its model never drops it.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { isReadOnlyServer } from '../api/client.js';

/** id -> the model's `lastRun` when it was removed (or null). */
let removed = new Map();
const listeners = new Set();

function publish(next) {
  removed = next;
  for (const listener of [...listeners]) listener();
}

/** Marks job `id` removed, as the model last said it ran. */
export function markRemoved(id, lastRun = null) {
  const next = new Map(removed);
  next.set(id, Number.isFinite(lastRun) ? lastRun : null);
  publish(next);
}

/** Forgets every removal (tests start each case afresh). */
export function forgetRemoved() {
  if (removed.size) publish(new Map());
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => removed;

/**
 * Whether entity `e` is one a Remove took off, by the removals `held`. A job
 * that reported again since is not.
 */
export function wasRemoved(held, e) {
  if (!held.has(e?.id)) return false;
  if (isReadOnlyServer()) return true;
  const before = held.get(e.id);
  return !(Number.isFinite(e.lastRun) && (before == null || e.lastRun > before));
}

/**
 * The removals, as a test of an entity (`hidden(e)`), and the model's
 * `status` to forget the ones it has dropped by. Re-renders when one is
 * added or forgotten.
 */
export function useRemovedJobs(status) {
  const held = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!status?.entities || held.size === 0 || isReadOnlyServer()) return;
    const ids = new Set(status.entities.map((e) => e.id));
    const gone = [...held.keys()].filter((id) => !ids.has(id));
    if (gone.length === 0) return;
    const next = new Map(removed);
    for (const id of gone) next.delete(id);
    publish(next);
  }, [status, held]);
  return held;
}
