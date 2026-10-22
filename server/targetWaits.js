/**
 * When each Prometheus scrape target JagHelm found waiting for its first scrape
 * began waiting (#476), for the targets whose list entry can't say
 * (status/upMissing.js listedWaitSince): counted from the first cycle that saw
 * it so. Persisted to data/prometheus-target-waits.json, so a restart doesn't
 * start the count again: a stuck target's source_down isn't followed by a
 * false recovery and a second page each time JagHelm restarts.
 *
 * A wait continues across a gap between two sightings of up to WAIT_GAP_MS
 * (or the target's own limit, when longer): a restart. A longer gap (JagHelm
 * was off a while, as when the host reboots and Prometheus restarts with it)
 * starts it again, so a target new since then isn't taken for a stuck one.
 *
 * Keyed by the target's scrape pool and URL. Discovery keeps only the targets
 * still waiting (retain), and empties it on a cycle that had no node to check.
 * A sighting is written when it starts a wait, and otherwise at most once a
 * SEEN_STEP_MS, so a target that keeps waiting doesn't write every cycle.
 */
import { join } from 'path';
import { createPresenceStore } from './presenceStore.js';
import { DATA_DIR } from './util/dataDir.js';

const DEFAULT_PATH = join(DATA_DIR, 'prometheus-target-waits.json');

/** The longest gap between two sightings of a waiting target that continues its wait. */
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
    /**
     * Record a sighting of the waiting target `key` at `at`, and return when
     * its wait began: kept from the last sighting when that was at most
     * `gapMs` (default WAIT_GAP_MS) ago, else `at`.
     */
    sighted(key, at, gapMs = WAIT_GAP_MS) {
      const rec = core.get(key);
      if (rec && at - rec.seen <= gapMs) {
        if (at - rec.seen >= SEEN_STEP_MS) {
          core.set(key, { since: rec.since, seen: at });
          core.markDirty();
        }
        return rec.since;
      }
      core.set(key, { since: at, seen: at });
      core.markDirty();
      return at;
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
