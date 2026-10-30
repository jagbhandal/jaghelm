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
 *   one tick in three /api/weather, the rail's weather (useWeather,
 *                     extras.js), on ticks 3, 6, 9 …, only once its 10
 *                     minutes (a failed read's one) are up
 *
 * so no tick asks for two slow ones. Both read the App's tick counter, which
 * runs only while the Overview is on screen and the browser tab shows; a
 * load, a Retry or a return to the Overview asks for every source at once
 * and is no tick. Off the Overview, the Launch page's Pipeline and weather
 * keep their own clocks, and the phone screens read /api/services alone
 * beside the status. The Alerts page and the phone's Alerts tab (#314) also
 * read /api/events, on each answer of the status poll.
 *
 * One exception, only while a node's or a container's detail drawer is
 * open (#311), or its sheet on a phone (#602: below 768px): its history charts read /api/history once their range's
 * step has passed (a minute at 1 h, 5 minutes at 24 h, 30 at 7 d), riding an
 * answer of the status poll (useHistory.js), so a tick can then cost a 5th
 * request, at most once a minute. A closed drawer or sheet reads nothing, nor
 * does a sheet covered by another, and the poll's pause in a hidden tab (the
 * app in the background) pauses it too. The other: the disk forecast (#670,
 * diskForecast.js) is read when the Infrastructure section or the phone's
 * Infra tab draws (only if its last read is over 30 minutes old), and every 30
 * minutes after, on a clock of its own and not
 * while the tab is hidden, so a tick can cost a 5th request once in 30
 * minutes. And the Backups section (#675, Backups.jsx), on the same terms as the
 * pending host steps below: read as it is drawn and every 5 minutes after, on a
 * clock of its own. And the pending host steps (#673, HostActions.jsx), read when the
 * Overview (or the phone's) draws them and every 5 minutes after, on a clock of
 * their own and not while the tab is hidden: a tick can then cost a 5th request
 * once in 5 minutes. The config drift row (#674, ConfigDrift.jsx) is read the
 * same way, every 5 minutes, on a clock of its own. And the Expiry list (#676,
 * Expiry.jsx), read when drawn and every 30 minutes after on a clock of its own
 * (every 3 seconds, ten times at most, while a newly added target is still being
 * checked).
 *
 * One more exception, only while the Monitoring page is open (#751, spec §7):
 * it reads /api/monitoring, every chart of the page in one request, once its
 * range's step has passed (a minute at 1 h, 5 at 24 h, 30 at 7 d, 2 hours at
 * 30 d), riding an answer of the status poll (useMonitoring.js), so a tick can
 * cost a 5th request, at most once a minute, and an unchanged answer is a 304.
 * The page is not the Overview, so the board's tick does not run on it and the
 * slow sources above are not read: its tick costs the status poll and this.
 * A closed page reads nothing, nor does a hidden tab (the poll pauses). The
 * phone's page (#755) reads the same way. src/shell/monitoring.test.jsx and
 * src/App.polling.test.jsx hold the budget, and e2e/budgets.spec.mjs holds it
 * on the built app.
 */

/** A slow source is read once every this many ticks. */
export const SLOW_EVERY = 3;

/** The slow source a scheduled tick may read: 'history', 'pipeline' or 'weather'. */
export function slowReadOf(tick) {
  const turn = ((Number(tick) % SLOW_EVERY) + SLOW_EVERY) % SLOW_EVERY;
  return turn === 1 ? 'history' : turn === 2 ? 'pipeline' : 'weather';
}
