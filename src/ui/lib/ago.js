/*
 * How long ago something was, as the shell says it ("12 s ago", "3 min
 * ago"), and a hook that keeps it moving: the header's "Updated 12 s ago"
 * (#296) and a stale status's "last known 3 min ago" (#480,
 * src/shell/statusFreshness.js), on the one clock (./clock.js), which also
 * judges how old an answer is (#559).
 */
import { useSyncExternalStore } from 'react';
import { clock } from './clock.js';

/** How long `ms` is, as the shell says an age: "12 s", "3 min", "2 h", "4 d". */
export function durationText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** How long ago `ms` was, as the header says it: "just now", "12 s ago", "3 min ago", "2 h ago", "4 d ago". */
export function agoText(ms) {
  if (!(ms >= 5000)) return 'just now';
  return `${durationText(ms)} ago`;
}

const idle = () => () => {};
const nothing = () => null;

/**
 * How long ago `at` was (ms since the epoch), as agoText says it, on the one
 * clock (./clock.js: it ticks each second while an age is on screen, and at
 * once as a hidden tab is shown again), so every age reads the same moment,
 * only the component that asks re-renders, only while it asks and only when
 * its words change; null while `at` is. UpdatedAgo's, and the stale status's "last known
 * 3 min ago" (#297, #480, src/shell/statusFreshness.js).
 */
export function useAgo(at) {
  const asking = at != null;
  return useSyncExternalStore(
    asking ? clock.subscribe : idle,
    asking ? () => agoText(clock.get() - at) : nothing
  );
}
