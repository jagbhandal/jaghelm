/*
 * How long ago something was, as the shell says it ("12 s ago", "3 min
 * ago"), and a hook that keeps it moving: the header's "Updated 12 s ago"
 * (#296) and a stale status's "last known 3 min ago" (#480,
 * src/shell/statusFreshness.js).
 */
import { useSyncExternalStore } from 'react';

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

/**
 * One clock for every age on screen (#480): it ticks each second while
 * anything shows an age, and stops when nothing does. Every age reads the
 * same moment, so two ages of the same time (the header's and the attention
 * panel's) never read a second apart, whenever each was drawn. A tab shown
 * again ticks at once, before anything the same event re-renders (on the
 * window, in the capture phase): its ticks were held back while it was
 * hidden, and an age read then would be as old as the tab's last tick.
 */
const clock = (() => {
  let now = Date.now();
  let timer = null;
  const listeners = new Set();
  const tick = () => {
    now = Date.now();
    for (const listener of [...listeners]) listener();
  };
  const shown = () => {
    if (!document.hidden) tick();
  };
  return {
    get: () => now,
    subscribe(listener) {
      if (listeners.size === 0) {
        now = Date.now();
        timer = setInterval(tick, 1000);
        window.addEventListener('visibilitychange', shown, true);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearInterval(timer);
          timer = null;
          window.removeEventListener('visibilitychange', shown, true);
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
