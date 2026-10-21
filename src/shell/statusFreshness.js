/**
 * Whether the status on screen is current, and how a stale one is drawn: the
 * one rule for every place that shows the status model (#480, #495).
 *
 * The status is stale when the header's poll (useStatus) has no current one:
 * `reach` is anything but 'ok' once the first answer is in, so a failed poll
 * ('down'), or a 503 ('waiting'), which the server answers once its status is
 * past the cache's TTL. The poll keeps the last status it had, so a page can
 * still say what it was; but a stale status never looks like a current one:
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
 * useStatusFreshness() is the one place that decides it: ShellHeader,
 * ShellAttention (the Alerts page and the Overview's panel), OverviewStatus
 * (the strip) and OverviewInfrastructure each call it, and draw what it says.
 * While the status is fresh it runs no clock and re-renders nothing.
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
});

/** Whether the poll's status isn't current: any reach but 'ok', once the first answer is in. */
export function isStale(reach) {
  return reach !== 'ok' && reach !== 'loading';
}

/** A state as the screen draws it: the model's while fresh, no signal while stale. */
export function drawnState(state, freshness) {
  return freshness?.stale ? STALE_STATE : state;
}

/** Why there is no signal, by the poll's reach and whether a status came before. */
function causeOf(reach, status) {
  if (reach === 'waiting') return status ? NO_SIGNAL.expired : NO_SIGNAL.waiting;
  return NO_SIGNAL.down;
}

/** "Last known 3 min ago", to start a line with. */
export function lastKnownCaption(freshness) {
  const said = freshness?.lastKnown;
  return said ? said[0].toUpperCase() + said.slice(1) : undefined;
}

const idle = () => () => {};
const nothing = () => null;

/**
 * The poll's freshness, from useStatus's `status`, `reach` and `updated` (the
 * last answer's time, as a store):
 *
 *   stale      the rule above
 *   ageText    how long ago the last answer came ("3 min ago"), counting on
 *              each second while stale; null while fresh, or with none
 *   lastKnown  "last known 3 min ago", while stale with a status to show
 *   note       "No signal · last known 3 min ago" (or "No signal"), while stale
 *   cause      why: "Can't reach JagHelm", "JagHelm's status is out of date"
 *              (a 503 after a status), "Waiting for the first check"
 *
 * Fresh, it is one frozen object, and the hook subscribes to nothing, so a
 * caller memoised on the poll re-renders only when the poll does.
 */
export function useStatusFreshness({ status, reach, updated }) {
  const stale = isStale(reach);
  const source = stale ? updated : null;
  const at = useSyncExternalStore(source?.subscribe ?? idle, source?.get ?? nothing);
  const ageText = useAgo(stale && status ? at : null);
  return useMemo(() => {
    if (!stale) return FRESH;
    const lastKnown = status && ageText ? `last known ${ageText}` : null;
    return {
      stale: true,
      ageText,
      lastKnown,
      note: lastKnown ? `${WORDS.unknown} · ${lastKnown}` : WORDS.unknown,
      cause: causeOf(reach, status),
    };
  }, [stale, status, reach, ageText]);
}
