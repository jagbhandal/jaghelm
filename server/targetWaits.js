/**
 * When each Prometheus scrape target JagHelm found waiting for its first scrape
 * began waiting (#476), for the targets whose list entry can't say
 * (status/upMissing.js listedWaitSince): counted from the first list that
 * showed it so. Persisted to data/prometheus-target-waits.json, so a restart
 * doesn't start the count again: a stuck target's source_down isn't followed
 * by a false recovery and a second page each time JagHelm restarts.
 *
 * Keyed by the target (its scrape pool and URL), not its node: a wait is kept
 * through cycles that read no target list (every node has `up` 1, say from a
 * healthy sibling target) and is forgotten only when a list no longer shows
 * the target waiting (retain). Discovery decides whether a wait still holds
 * (Prometheus may have restarted since it began); this only keeps it. A
 * sighting is written when it starts a wait, and otherwise at most once a
 * SEEN_STEP_MS, so a target that keeps waiting doesn't write every cycle.
 */
import { join } from 'path';
import { createPresenceStore } from './presenceStore.js';
import { DATA_DIR } from './util/dataDir.js';

const DEFAULT_PATH = join(DATA_DIR, 'prometheus-target-waits.json');

/**
 * When Prometheus can't say when it started: the longest gap between two
 * sightings of a waiting target that continues its wait (discovery.js).
 */
export const WAIT_GAP_MS = 5 * 60_000;

/** How far a sighting moves on before it is written. */
export const SEEN_STEP_MS = 60_000;

function sanitizeWait(v) {
  if (!v || typeof v !== 'object') return null;
  const since = Number(v.since);
  const seen = Number(v.seen);
  return Number.isFinite(since) && Number.isFinite(seen) ? { since, seen } : null;
}

/** A target's key: its scrape pool and URL, or its labels when the list gives no URL. */
export function targetKey(t) {
  if (t?.scrapeUrl) return `${t.scrapePool ?? ''} ${t.scrapeUrl}`;
  const labels = Object.entries(t?.labels ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(labels);
}

export function createTargetWaits({ path = DEFAULT_PATH, write } = {}) {
  const core = createPresenceStore({ path, sanitize: sanitizeWait, write });
  return {
    /** The wait of target `key`: { since, seen } (its start, its last written sighting), or undefined. */
    get(key) {
      return core.get(key);
    },
    /** Start target `key`'s wait at `at`. */
    begin(key, at) {
      core.set(key, { since: at, seen: at });
      core.markDirty();
    },
    /** A sighting of target `key` at `at`, still waiting: written once it moves SEEN_STEP_MS on. */
    touch(key, at) {
      const rec = core.get(key);
      if (!rec || at - rec.seen < SEEN_STEP_MS) return;
      core.set(key, { since: rec.since, seen: at });
      core.markDirty();
    },
    /** Forget every target but those in `keys` (a Set). */
    retain(keys) {
      for (const key of core.keys()) {
        if (keys.has(key)) continue;
        core.delete(key);
        core.markDirty();
      }
    },
    /** The waits as kept: key -> { since, seen }. */
    entries() {
      return core.snapshot();
    },
    /** Write the file if anything changed. */
    save() {
      core.save();
    },
  };
}
