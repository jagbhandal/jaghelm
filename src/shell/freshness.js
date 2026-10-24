/**
 * How old the client's last answer may get before what it brought is stale:
 * the one rule (#480, #559), for every place on the client that judges it.
 *
 *   - the header's status (useStatusStale, statusFreshness.js), on the status
 *     poll's answers, and so every place that draws the status, the Alerts
 *     badge and the phone screens;
 *   - the Overview's sections' "updated … ago" notes (useDashboardData), on
 *     /api/services' and /api/integrations' answers.
 *
 * An answer is stale from `staleAfterMs(interval)` after it on: two polls
 * missed, and the next one's request run to its timeout (72 s at the default
 * 30 s interval). The timeout is in it so a source that missed one poll and
 * answers the next slowly never reads stale between. Each judge reads the
 * one clock (`clock`, src/ui/lib/clock.js) and watches its own deadline on
 * it, so for the same answer time the header and a panel flip at the same
 * moment, by construction: the same formula, the same "now", the same move.
 * That holds through a hidden tab and a sleeping laptop too: the clock moves
 * as the tab is shown again and as the machine wakes, and every judge reads
 * that move; neither excuses the time it asked nothing.
 *
 * Server-side staleness (the status model's no-signal rules) is not this:
 * this is the client's view of how old its last answer is.
 */
import { REQUEST_TIMEOUT_MS } from '../hooks/useData.js';
import { clock } from '../ui/lib/clock.js';

export { clock };

/** How long after an answer what it brought is stale, at a poll interval. */
export function staleAfterMs(intervalMs) {
  return 2 * intervalMs + REQUEST_TIMEOUT_MS;
}

/** When an answer at `at` goes stale (ms since the epoch); null without one. */
export function staleAt(at, staleAfter) {
  return at != null && staleAfter != null ? at + staleAfter : null;
}

/** Whether an answer at `at` is stale at `now`: the one clock's, unless a test says. */
export function isTooOld(at, staleAfter, now = clock.get()) {
  const due = staleAt(at, staleAfter);
  return due != null && now >= due;
}
