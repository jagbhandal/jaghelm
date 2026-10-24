/**
 * The phase-lock hint (#630): X-Next-Refresh-Ms on /api/status and
 * /api/services, how many ms until the background loop's next cycle should
 * have built what they serve. A duration, not a time, so the browser's clock
 * can't skew it; set on the 304 too. A browser that sees it polls then
 * instead of on a free-running timer (src/pollSchedule.js); without a loop
 * running, or from an older server, there is no header and it keeps its
 * fixed interval.
 */
import { nextRefreshHintMs } from './refresh.js';

export function refreshHint(req, res, next) {
  const ms = nextRefreshHintMs();
  if (ms !== null) res.set('X-Next-Refresh-Ms', String(ms));
  next();
}
