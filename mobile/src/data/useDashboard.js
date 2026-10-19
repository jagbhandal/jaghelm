import { useState, useEffect, useCallback, useRef } from 'react';
import { App } from '@capacitor/app';
import {
  getServices,
  getUPSStatus,
  getCronStatus,
  getDisplayConfig,
  NOT_MODIFIED_NO_BODY,
} from '@shared/hooks/useData.js';
import { createPollScheduler } from './pollScheduler.js';

// Fallback cadence when the display config can't be read. Matches the web
// dashboard's own default (config.refreshInterval || 30).
const DEFAULT_REFRESH_MS = 30000;
// Floor so a misconfigured tiny interval can't hammer the backend.
const MIN_REFRESH_MS = 5000;

// Whether a fetch result carries a body to apply. A 304 hands back the SAME
// reference as the last 200 (useData.js), so applying it is a no-op setState;
// the cold-start 304 sentinel and a failed side source (null) carry nothing.
const hasBody = (v) => v != null && v !== NOT_MODIFIED_NO_BODY;

/**
 * The single live-data source for the mobile screens. Shaping is done by
 * derive.js; this hook holds raw bodies + loading/error. The services fetch is
 * the health gate: if it throws, `error` is set; UPS/cron failures keep their
 * last value.
 *
 * One poll scheduler (pollScheduler.js) drives every fetch round, by reason:
 *   'force'  — the first load and a tap on the status bar: full bodies
 *              (skipEtag), past any HTTP cache.
 *   'poll'   — every refresh interval: If-None-Match, so an unchanged source
 *              is a bodiless 304 that keeps the current reference (no data
 *              re-render, derived memos hold).
 *   'resume' — the app came back to the foreground: conditional too (a
 *              conditional request is never answered from an HTTP cache), but
 *              /cron/status, which has no ETag and a 60 s max-age, is fetched
 *              past the cache so a copy from before the trip can't come back.
 * The scheduler stops when the app goes to the background (Capacitor
 * `appStateChange`) and runs one round at once on return.
 *
 * The refresh cadence is read from the server's dashboard config so the mobile
 * countdown stays in lockstep with the web app's auto-refresh. `lastUpdated`
 * (ms epoch of the last round the server answered, 200 or 304) + `intervalMs`
 * drive the status bar's "HH:MM · next Ys": the next poll is armed one interval
 * after a round lands, and a failed round doesn't move the clock.
 */
export function useDashboard() {
  const [servicesBody, setServicesBody] = useState(null);
  const [ups, setUps] = useState(null);
  const [cron, setCron] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [intervalMs, setIntervalMs] = useState(DEFAULT_REFRESH_MS);
  const [lastUpdated, setLastUpdated] = useState(null);
  const schedulerRef = useRef(null);

  useEffect(() => {
    let live = true;

    const round = async (reason) => {
      const force = reason === 'force';
      const pastCache = reason !== 'poll';
      try {
        const [s, u, c] = await Promise.all([
          getServices(force),
          getUPSStatus(force).catch(() => null),
          getCronStatus(pastCache).catch(() => null),
        ]);
        if (!live) return;
        if (hasBody(s)) setServicesBody(s);
        if (hasBody(u)) setUps(u);
        if (hasBody(c)) setCron(c);
        setError(null);
        setLastUpdated(Date.now());
      } catch (err) {
        if (live) setError(err);
      } finally {
        if (live) setLoading(false);
      }
    };

    const scheduler = createPollScheduler(round, { intervalMs: DEFAULT_REFRESH_MS });
    schedulerRef.current = scheduler;
    scheduler.start('force');

    // Sync the cadence to the display config's refreshInterval (the SAME source
    // the web dashboard uses). Best-effort: any failure keeps the default.
    getDisplayConfig()
      .then((cfg) => {
        if (!live || !cfg || !Number.isFinite(cfg.refreshInterval)) return;
        const ms = Math.max(MIN_REFRESH_MS, cfg.refreshInterval * 1000);
        setIntervalMs(ms);
        scheduler.setIntervalMs(ms);
      })
      .catch(() => {});

    const listener = Promise.resolve(
      App.addListener('appStateChange', ({ isActive }) => {
        if (!live) return;
        if (isActive) scheduler.start('resume');
        else scheduler.stop();
      })
    ).catch(() => null);

    return () => {
      live = false;
      scheduler.stop();
      schedulerRef.current = null;
      listener.then((h) => h?.remove?.()).catch(() => {});
    };
  }, []);

  const refresh = useCallback(() => schedulerRef.current?.refresh('force') ?? Promise.resolve(), []);

  return { servicesBody, ups, cron, loading, error, refresh, intervalMs, lastUpdated };
}
