/**
 * Whether the status on screen is current, and how a stale one is drawn: the
 * one rule for every place that shows the status model (#480, #495).
 *
 * The status is stale when the header's poll (useStatus) has no current one:
 * `reach` is anything but 'ok' once the first answer is in, so a failed poll
 * ('down'), or a 503 ('waiting'), which the server answers once its status is
 * past the cache's TTL; or the last answer is older than the poll allows
 * (`updated.staleAfter`, the client's one rule, freshness.js: two polls and
 * the request timeout, 72 s at the default interval), as after a hidden tab
 * or a sleeping laptop, when nothing was asked and `reach` is still 'ok'. The poll keeps the last status it had,
 * so a page can still say what it was; but a stale status never looks like a
 * current one:
 *
 *  - every state drawn from it is no signal (`drawnState`): the steel ring and
 *    the steel word, never green, amber or red. Its words, counts, reasons and
 *    readings stay, as what was last known;
 *  - each place says how old it is, "No signal · last known 3 min ago", by
 *    the one clock (useAgo's, src/ui/lib/clock.js), so the header, the
 *    attention panel, the subsystem strip and the Infrastructure section read
 *    the same age at the same time;
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
 * While the status is fresh nothing ticks for it and nothing re-renders: the
 * one clock's one timer waits for the boundary, re-armed on each answer, and
 * moves at once as a tab is shown again. The Overview's sections' notes judge
 * their own answers by the same rule on the same clock (useDashboardData,
 * #559), so for the same answer time they and the header flip together.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { useAgo } from '../ui/lib/ago.js';
import { NO_SIGNAL, WORDS } from '../ui/lib/status.js';
import { clock, isTooOld, staleAt } from './freshness.js';

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

/** Whether the last answer in `updated` is older than the store allows, on the one clock. */
function tooOld(updated) {
  return isTooOld(updated.get(), updated.staleAfter);
}

const watches = new WeakMap();

/**
 * Whether the poll's last answer is too old, as a subscription for every
 * place that reads it: the one clock (freshness.js) wakes it at the boundary
 * (its one timer, to the earliest boundary any judge watches, the Overview's
 * sections' notes too), as the tab is shown again and as the machine wakes;
 * each answer moves the boundary, and re-arms the clock (the first answer
 * starts one). Only a change of the answer re-renders.
 */
function watchOf(updated) {
  let subscribe = watches.get(updated);
  if (!subscribe) {
    const due = () => staleAt(updated.get(), updated.staleAfter);
    subscribe = (listener) => {
      const stopClock = clock.watch(due, listener);
      const stopAnswers = updated.subscribe(() => {
        clock.rearm();
        listener();
      });
      return () => {
        stopAnswers();
        stopClock();
      };
    };
    watches.set(updated, subscribe);
  }
  return subscribe;
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

const NO_CLOCK = { subscribe: () => () => {}, get: () => null };

/**
 * The time of the status in `updated` (statusBuiltAt), re-read on each
 * answer; null with no `updated` or before the first answer. The phone
 * screens (#303) age the model's `since`s against it, as the issue rows do.
 */
export function useStatusAt(updated) {
  const store = updated ?? NO_CLOCK;
  return useSyncExternalStore(store.subscribe, () => (updated ? statusBuiltAt(updated) : null));
}

/**
 * Whether the poll's status is stale, by the rule above: `reach`, or the age
 * of the last answer in `updated`. It re-renders only when that changes.
 */
export function useStatusStale({ reach, updated }) {
  const tooOldNow = useSyncExternalStore(
    updated ? watchOf(updated) : idle,
    updated ? () => tooOld(updated) : never
  );
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
 * Fresh, it is one frozen object, and nothing ticks for it: only the one
 * clock's timer to the boundary, so a caller memoised on the poll re-renders
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
