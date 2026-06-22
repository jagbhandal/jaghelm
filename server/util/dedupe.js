/**
 * In-flight promise deduplication by slot key. Concurrent callers on the same
 * slot share one execution — used by refresh.js to avoid cache-stampede when
 * several tabs hit the dashboard at cold start and each kicks off a refresh.
 *
 * The slot clears as soon as the promise settles (resolve OR reject) so the next
 * caller gets a fresh attempt — a stuck rejection must not poison the slot.
 *
 * `inFlightSlots` is exported for tests/diagnostics only; do not mutate.
 */

export const inFlightSlots = new Map();

export function dedupe(slot, fn) {
  const existing = inFlightSlots.get(slot);
  if (existing) return existing;
  const p = (async () => fn())();
  inFlightSlots.set(slot, p);
  // Use .then(noop, noop) so we observe both fulfillment and rejection on a
  // side branch (clearing the slot) without producing a second "unhandled
  // rejection". The caller's branch — the `p` we return — is still rejected
  // normally and surfaces to whoever awaits it.
  p.then(
    () => { if (inFlightSlots.get(slot) === p) inFlightSlots.delete(slot); },
    () => { if (inFlightSlots.get(slot) === p) inFlightSlots.delete(slot); }
  );
  return p;
}
