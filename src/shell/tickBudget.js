/**
 * The request budget of one refresh tick (spec §4, #306): at most 4 requests
 * a tab makes per tick (30 s by default), none while it is hidden. On the
 * desktop's Overview:
 *
 *   every tick        /api/status (the header's poll, useStatus),
 *                     /api/services and /api/integrations (useDashboardData)
 *   one tick in three /api/history, the node cards' hour of CPU
 *                     (useDashboardData), on ticks 1, 4, 7 …
 *   one tick in three /api/gitea/activity, the rail's Pipeline (usePipeline,
 *                     utilities.js), on ticks 2, 5, 8 …
 *
 * so no tick asks for both slow ones. Both read the App's tick counter, which
 * runs only while the Overview is on screen and the browser tab shows; a
 * load, a Retry or a return to the Overview asks for every source at once
 * and is no tick. Off the Overview, the Launch page's Pipeline keeps its own
 * clock (every SLOW_EVERY refresh intervals), and the phone screens read
 * /api/services alone beside the status.
 */

/** A slow source is read once every this many ticks. */
export const SLOW_EVERY = 3;

/** The slow source a scheduled tick reads: 'history', 'pipeline', or null. */
export function slowReadOf(tick) {
  const turn = ((Number(tick) % SLOW_EVERY) + SLOW_EVERY) % SLOW_EVERY;
  return turn === 1 ? 'history' : turn === 2 ? 'pipeline' : null;
}
