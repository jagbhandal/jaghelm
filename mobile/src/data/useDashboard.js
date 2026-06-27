import { useState, useEffect, useCallback, useRef } from 'react';
import { getServices, getUPSStatus, getCronStatus, getDisplayConfig } from '@shared/hooks/useData.js';

// Fallback cadence when the display config can't be read. Matches the web
// dashboard's own default (config.refreshInterval || 30).
const DEFAULT_REFRESH_MS = 30000;
// Floor so a misconfigured tiny interval can't hammer the backend.
const MIN_REFRESH_MS = 5000;

/**
 * The single live-data source for the mobile screens. Fetches the three read-only
 * endpoints on mount + every refresh interval. Shaping is done by derive.js; this
 * hook only holds raw bodies + loading/error. The services fetch is the health
 * gate: if it throws, `error` is set; UPS/cron failures degrade silently to last
 * value.
 *
 * The refresh cadence is read from the server's dashboard config so the mobile
 * countdown stays in lockstep with the web app's auto-refresh. `lastUpdated`
 * (ms epoch of the last successful poll) + `intervalMs` are returned so the UI
 * can show "updated Xs ago / next in Ys".
 *
 * // /history (node CPU/MEM/DISK series) is fetched in Phase 5 when the Sparkline lands — omitted here to avoid a poll nobody reads.
 */
export function useDashboard() {
  const [state, setState] = useState({ servicesBody: null, ups: null, cron: null, loading: true, error: null });
  const [intervalMs, setIntervalMs] = useState(DEFAULT_REFRESH_MS);
  const [lastUpdated, setLastUpdated] = useState(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [servicesBody, ups, cron] = await Promise.all([
        getServices(true),
        getUPSStatus(true).catch(() => null),
        getCronStatus(true).catch(() => null),
      ]);
      if (!mounted.current) return;
      setState((s) => ({
        servicesBody: servicesBody ?? s.servicesBody,
        ups: ups ?? s.ups,
        cron: cron ?? s.cron,
        loading: false, error: null,
      }));
      setLastUpdated(Date.now()); // a completed poll (incl. 304) advances the clock
    } catch (err) {
      if (!mounted.current) return;
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  // Sync the cadence to the display config's refreshInterval (the SAME source the
  // web dashboard uses). Best-effort: any failure keeps the default cadence.
  useEffect(() => {
    let active = true;
    getDisplayConfig()
      .then((cfg) => {
        if (!active || !cfg || !Number.isFinite(cfg.refreshInterval)) return;
        setIntervalMs(Math.max(MIN_REFRESH_MS, cfg.refreshInterval * 1000));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Initial fetch, once on mount.
  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  // Polling timer — re-armed when the cadence changes, WITHOUT an extra
  // immediate fetch (the mount effect above already did the first one).
  useEffect(() => {
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { ...state, refresh, intervalMs, lastUpdated };
}
