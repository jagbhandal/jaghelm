/**
 * The disk forecast on the nodes (#670): "12 days left" under a node's disk
 * meter, from /api/disk-forecast (server/diskForecast.js), coloured by the
 * lines Settings → Nodes & Services keeps (`diskForecastDays`, default 14 and
 * 3 days). The client judges nothing about the disk; it only draws the
 * server's days against those two lines. Nothing here alerts.
 *
 * What is drawn (`forecastNote`):
 *  - a line that fits (`ok`): "N days left", amber under the warn line, red
 *    under the crit line, with an icon and, past a line, a word, so it never
 *    rests on colour alone ("/data: " in front when it is not the mount the
 *    meter shows);
 *  - a node the forecast has no current readings for (`nodata`: shut down,
 *    or not scraped), or any forecast while the status or the node's own disk
 *    reading is stale: "No signal", never a number;
 *  - everything else (stable, noisy, too little history): nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { forecastLines } from '../../server/diskForecastLines.js';
import { getDiskForecast } from '../hooks/useData.js';

/**
 * How often the forecast is asked again: it is a line through a week of
 * readings, so it hardly moves in half an hour, and a tab left open shouldn't
 * ask more (the server keeps one answer 10 minutes). It rides no refresh tick:
 * a read on load and one a half hour on is the one exception to the tick's
 * 4-request budget besides the history charts' (tickBudget.js).
 */
export const FORECAST_POLL_MS = 30 * 60_000;

/** The state a number of days left is drawn in against the lines. */
export function forecastState(days, { warn, crit }) {
  if (days < crit) return 'crit';
  if (days < warn) return 'warn';
  return 'ok';
}

/** "12 days left", "1 day left", "Under 1 day left". */
export function daysLeftText(days) {
  if (days < 1) return 'Under 1 day left';
  const whole = Math.floor(days);
  return `${whole} ${whole === 1 ? 'day' : 'days'} left`;
}

const NO_SIGNAL = Object.freeze({
  state: 'unknown',
  text: 'No signal',
  said: 'Disk forecast: no signal',
});

/**
 * The note under a node's disk meter: `{ state, text, said }` or null.
 *
 * @param {any} forecast  one node's entry of /api/disk-forecast, or undefined
 * @param {{ warn: number, crit: number }} lines
 * @param {{ stale?: boolean, unread?: boolean }} [drawn]  the status is stale,
 *   or the disk reading itself has no current value
 */
export function forecastNote(forecast, lines, { stale = false, unread = false } = {}) {
  if (!forecast) return null;
  if (forecast.status === 'nodata') return NO_SIGNAL;
  if (forecast.status !== 'ok' || !Number.isFinite(forecast.daysLeft)) return null;
  if (stale || unread) return NO_SIGNAL;
  const state = forecastState(forecast.daysLeft, lines);
  const text = `${forecast.primary === false ? `${forecast.mount}: ` : ''}${daysLeftText(forecast.daysLeft)}`;
  const word = state === 'warn' ? ', warning' : state === 'crit' ? ', critical' : '';
  return { state, text, said: `Disk forecast: ${text}${word}` };
}

/** The lines to draw by: Settings' `diskForecastDays`, or 14 and 3 days. */
export function forecastLinesOf(config) {
  return forecastLines(config?.diskForecastDays);
}

/**
 * /api/disk-forecast, read when `active` and again every FORECAST_POLL_MS
 * (not while the browser tab is hidden; on return, if one is due): the
 * answer's nodes by node key, or `{}` before the first answer and while the
 * server can't say (`ok: false`, a failed read: no node is told "No signal"
 * for Prometheus's trouble). A failed request keeps the last answer.
 */
export function useDiskForecast({ active = true, intervalMs = FORECAST_POLL_MS } = {}) {
  const [body, setBody] = useState(null);
  const seq = useRef(0);
  const readAt = useRef(0);
  const read = useCallback(async () => {
    const mine = ++seq.current;
    readAt.current = Date.now();
    try {
      const next = await getDiskForecast();
      if (mine === seq.current && next && typeof next === 'object' && next.nodes) setBody(next);
    } catch {
      // Keep the last answer: the forecast moves over days.
    }
  }, []);
  useEffect(() => {
    if (!active) return undefined;
    const due = () => !document.hidden && Date.now() - readAt.current >= intervalMs;
    read();
    const id = setInterval(() => due() && read(), Math.min(intervalMs, 60_000));
    const onShow = () => due() && read();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
      seq.current += 1;
    };
  }, [active, intervalMs, read]);
  return body?.ok ? body.nodes : EMPTY;
}

const EMPTY = Object.freeze({});
