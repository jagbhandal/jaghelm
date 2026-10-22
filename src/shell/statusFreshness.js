/**
 * Whether the status on screen is current, and how a stale one is drawn: the
 * one rule for every place that shows the status model (#480, #495).
 *
 * The status is stale when the header's poll (useStatus) has no current one:
 * `reach` is anything but 'ok' once the first answer is in, so a failed poll
 * ('down'), or a 503 ('waiting'), which the server answers once its status is
 * past the cache's TTL; or the last answer is older than the poll allows
 * (`updated.staleAfter`: two polls and the request timeout, 72 s at the
 * default interval), as after a hidden tab or a sleeping laptop, when nothing
 * was asked and `reach` is still 'ok'. The poll keeps the last status it had,
 * so a page can still say what it was; but a stale status never looks like a
 * current one:
 *
 *  - every state drawn from it is no signal (`drawnState`): the steel ring and
 *    the steel word, never green, amber or red. Its words, counts, reasons and
 *    readings stay, as what was last known;
 *  - each place says how old it is, "No signal · last known 3 min ago", by
 *    one clock (useAgo's), so the header, the attention panel, the subsystem
 *    strip and the Infrastructure section read the same age at the same time;
 *  - back to fresh, everything takes the model's colours again in the render
 *    that brings the answer.
 *
 * Two times, two rules (#499). Whether the status is stale goes by when the
 * last answer came (`updated.get()`, against `staleAfter`): it asks whether
 * the poll is getting answers. How old it says the status is goes by when the
 * server built it (`updated.builtAt()`, the answer's Last-Modified): a status
 * is that old whatever the poll did, and after a 503 (past the server's TTL)
 * it is older than the poll's last answer. From a server that doesn't say, the
 * age counts from the answer, as before.
 *
 * useStatusFreshness() is the one place that decides it: ShellHeader,
 * ShellAttention (the Alerts page and the Overview's panel), OverviewStatus
 * (the strip) and OverviewInfrastructure each call it, and draw what it says
 * (the Alerts badge takes useStatusStale(), the same rule without the age).
 * While the status is fresh it runs no clock and re-renders nothing: one
 * timer, shared by every place, waits for the boundary, re-armed on each
 * answer, and a tab shown again checks at once.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { useAgo } from '../ui/lib/ago.js';
import { NO_SIGNAL, WORDS } from '../ui/lib/status.js';

/** What the screen draws in place of every state of a stale status. */
export const STALE_STATE = 'unknown';

/** What a fresh status is: nothing to say. */
const FRESH = Object.freeze({
  stale: false,
  ageText: null,
  lastKnown: null,
  note: null,
  cause: null,
  reach: null,
});

/** Whether the poll says its status isn't current: any reach but 'ok', once the first answer is in. */
export function isStale(reach) {
  return reach !== 'ok' && reach !== 'loading';
}

/** Whether the last answer in `updated` is older than the store allows, now. */
function tooOld(updated) {
  const at = updated.get();
  return at != null && updated.staleAfter != null && Date.now() - at >= updated.staleAfter;
}

/**
 * Whether the poll's last answer is too old, as a store for every place that
 * reads it: one timer to the boundary while it isn't, re-armed on each
 * answer, and a check as the tab is shown again (its timers may have been held
 * back, or the machine asleep). Only a change of the answer re-renders.
 */
function ageWatch(updated) {
  const listeners = new Set();
  let timer = null;
  let stop = null;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const arm = () => {
    clearTimeout(timer);
    timer = null;
    const at = updated.get();
    if (at == null || updated.staleAfter == null) return;
    const left = at + updated.staleAfter - Date.now();
    // A timer that fires early finds the answer still fresh, and waits again.
    if (left > 0) timer = setTimeout(check, left);
  };
  const check = () => {
    arm();
    notify();
  };
  const shown = () => {
    if (!document.hidden) check();
  };
  return {
    get: () => tooOld(updated),
    subscribe(listener) {
      if (listeners.size === 0) {
        stop = updated.subscribe(check);
        document.addEventListener('visibilitychange', shown);
        arm();
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop();
          document.removeEventListener('visibilitychange', shown);
          clearTimeout(timer);
          timer = null;
        }
      };
    },
  };
}

const watches = new WeakMap();

/** The one watch of `updated`'s age, shared by every place that reads it. */
function watchOf(updated) {
  let watch = watches.get(updated);
  if (!watch) {
    watch = ageWatch(updated);
    watches.set(updated, watch);
  }
  return watch;
}

const idle = () => () => {};
const nothing = () => null;
const never = () => false;

/**
 * When the status in `updated` was built, for its age (#499): the server's
 * build time, or, from a server that doesn't send one, when the answer came.
 * The header's "Updated 12 s ago" reads it too, so it says the same age.
 */
export function statusBuiltAt(updated) {
  return updated.builtAt?.() ?? updated.get();
}

/**
 * Whether the poll's status is stale, by the rule above: `reach`, or the age
 * of the last answer in `updated`. It re-renders only when that changes.
 */
export function useStatusStale({ reach, updated }) {
  const watch = updated ? watchOf(updated) : null;
  const tooOldNow = useSyncExternalStore(watch?.subscribe ?? idle, watch?.get ?? never);
  return isStale(reach) || (reach !== 'loading' && tooOldNow);
}

/** A state as the screen draws it: the model's while fresh, no signal while stale. */
export function drawnState(state, freshness) {
  return freshness?.stale ? STALE_STATE : state;
}

/**
 * Why there is no signal, as a reach NO_SIGNAL names: 'waiting' (a 503 with
 * no status yet), 'expired' (a status, out of date: a 503 after one, or no
 * answer for too long while the poll's reach is still 'ok') or 'down'.
 */
function staleReach(reach, status) {
  if (reach === 'waiting') return status ? 'expired' : 'waiting';
  if (reach === 'ok') return 'expired';
  return 'down';
}

/** "Last known 3 min ago", to start a line with. */
export function lastKnownCaption(freshness) {
  const said = freshness?.lastKnown;
  return said ? said[0].toUpperCase() + said.slice(1) : undefined;
}

/**
 * The poll's freshness, from useStatus's `status`, `reach` and `updated` (the
 * last answer's time, as a store, with its `staleAfter` and `builtAt`):
 *
 *   stale      the rule above
 *   ageText    how old the status is ("3 min ago"): since the server built
 *              it, or since the last answer from a server that doesn't say;
 *              counting on each second while stale; null while fresh, or
 *              with none
 *   lastKnown  "last known 3 min ago", while stale with a status to show
 *   note       "No signal · last known 3 min ago" (or "No signal"), while stale
 *   cause      why: "Can't reach JagHelm", "JagHelm's status is out of date"
 *              (a 503 after a status, or no answer for too long), "Waiting
 *              for the first check"
 *   reach      the same why, as NO_SIGNAL's key ('down', 'expired',
 *              'waiting'), for the header; null while fresh
 *
 * Fresh, it is one frozen object, and the hook runs no clock: only the
 * shared timer to the boundary, so a caller memoised on the poll re-renders
 * only when the poll does, or when its status goes stale.
 */
export function useStatusFreshness({ status, reach, updated }) {
  const stale = useStatusStale({ reach, updated });
  const source = stale ? updated : null;
  const built = useSyncExternalStore(
    source?.subscribe ?? idle,
    source ? () => statusBuiltAt(source) : nothing
  );
  const ageText = useAgo(stale && status ? built : null);
  return useMemo(() => {
    if (!stale) return FRESH;
    const lastKnown = status && ageText ? `last known ${ageText}` : null;
    const why = staleReach(reach, status);
    return {
      stale: true,
      ageText,
      lastKnown,
      note: lastKnown ? `${WORDS.unknown} · ${lastKnown}` : WORDS.unknown,
      cause: NO_SIGNAL[why],
      reach: why,
    };
  }, [stale, status, reach, ageText]);
}
