/**
 * Ask the polls to read again now (#688): after a change the server has just
 * made to what they show (a missing container forgotten), waiting for the next
 * phase-locked tick would show the old board for up to a cycle. The status
 * poll (hooks/useStatus.js) and App's data tick subscribe; anything may call
 * `refreshNow()`. With nobody subscribed (a test, a hidden tab) it does nothing.
 */
const listeners = new Set();

/** Subscribes `fn` to refresh requests; returns the unsubscribe. */
export function onRefreshNow(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function refreshNow() {
  for (const fn of [...listeners]) fn();
}
