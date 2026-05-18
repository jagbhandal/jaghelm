/**
 * In-flight promise deduplication by slot key.
 *
 * Multiple concurrent callers asking for the same slot share one underlying
 * execution. Used by refresh.js to avoid cache-stampede when several browser
 * tabs hit the dashboard at cold start and each kicks off a full refresh.
 *
 * The slot is cleared as soon as the in-flight promise settles (resolve or
 * reject) so the next caller sees a fresh attempt — we don't want a stuck
 * rejection to permanently poison the slot.
 *
 *   const fresh = await dedupe('services', () => doExpensiveRefresh());
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
