/*
 * How long ago something was, as the shell says it ("12 s ago", "3 min
 * ago"), and a hook that keeps it moving: the header's "Updated 12 s ago"
 * (#296) and a stale status's "last known 3 min ago" (#480,
 * src/shell/statusFreshness.js).
 */
import { useSyncExternalStore } from 'react';

/** How long ago `ms` was, as the header says it: "just now", "12 s", "3 min", "2 h", "4 d". */
export function agoText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/**
 * One clock for every age on screen (#480): it ticks each second while
 * anything shows an age, and stops when nothing does. Every age reads the
 * same moment, so two ages of the same time (the header's and the attention
 * panel's) never read a second apart, whenever each was drawn.
 */
const clock = (() => {
  let now = Date.now();
  let timer = null;
  const listeners = new Set();
  const tick = () => {
    now = Date.now();
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => now,
    subscribe(listener) {
      if (listeners.size === 0) {
        now = Date.now();
        timer = setInterval(tick, 1000);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
})();

const idle = () => () => {};
const never = () => 0;

/**
 * How long ago `at` was (ms since the epoch), as agoText says it, on the one
 * clock above, so only the component that asks re-renders, and only while it
 * asks; null while `at` is. UpdatedAgo's, and the stale status's "last known
 * 3 min ago" (#297, #480, src/shell/statusFreshness.js).
 */
export function useAgo(at) {
  const asking = at != null;
  const now = useSyncExternalStore(asking ? clock.subscribe : idle, asking ? clock.get : never);
  return asking ? agoText(now - at) : null;
}
