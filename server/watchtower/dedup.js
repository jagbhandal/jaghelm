import { createHash } from 'crypto';

// In-memory dedup so shoutrrr retries / network blips don't double-notify.
export function createDedup({ windowMs = 5 * 60 * 1000, maxEntries = 2000 } = {}) {
  const seenAt = new Map(); // key -> last-seen epoch ms

  function keyOf({ node, updated, failed }) {
    const u = updated.map((x) => `u:${x.name}:${x.from}:${x.to}`).sort();
    const f = failed.map((x) => `f:${x.name}:${x.error}`).sort();
    return createHash('sha256').update([node, ...u, ...f].join('\n')).digest('hex');
  }

  function isDuplicate(report, now) {
    // Prune time-expired entries first. Deleting during for...of is safe per the
    // Map iteration spec (entries deleted before being visited are skipped). The
    // key hashes node + full report content, so distinct reports from one node
    // each get their own entry — pruning is purely time-based, hence the hard
    // size cap below as a backstop against a (secret-holding) flood of uniques.
    for (const [k, ts] of seenAt) if (now - ts > windowMs) seenAt.delete(k);
    const key = keyOf(report);
    const prev = seenAt.get(key);
    seenAt.set(key, now);
    if (seenAt.size > maxEntries) {
      // Map preserves insertion order; the first key is the oldest insertion.
      seenAt.delete(seenAt.keys().next().value);
    }
    return prev !== undefined && now - prev <= windowMs;
  }

  // keyOf stays internal — its hash format is an implementation detail callers
  // must not depend on; the only public operation is isDuplicate.
  return { isDuplicate };
}
