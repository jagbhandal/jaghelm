import { useState, useEffect, useCallback, useRef } from 'react';
import { getServices, getUPSStatus, getCronStatus, getMetricHistory } from '@shared/hooks/useData.js';

const REFRESH_MS = 30000;

/**
 * The single live-data source for the mobile screens. Fetches the four read-only
 * endpoints on mount + every 30s. Shaping is done by derive.js; this hook only
 * holds raw bodies + loading/error. The services fetch is the health gate: if it
 * throws, `error` is set; UPS/cron/history failures degrade silently to last value.
 */
export function useDashboard() {
  const [state, setState] = useState({ servicesBody: null, ups: null, cron: null, history: null, loading: true, error: null });
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [servicesBody, ups, cron, history] = await Promise.all([
        getServices(true),
        getUPSStatus(true).catch(() => null),
        getCronStatus(true).catch(() => null),
        getMetricHistory().catch(() => null),
      ]);
      if (!mounted.current) return;
      setState((s) => ({
        servicesBody: servicesBody ?? s.servicesBody,
        ups: ups ?? s.ups,
        cron: cron ?? s.cron,
        history: history ?? s.history,
        loading: false, error: null,
      }));
    } catch (err) {
      if (!mounted.current) return;
      setState((s) => ({ ...s, loading: false, error: err }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => { mounted.current = false; clearInterval(id); };
  }, [refresh]);

  return { ...state, refresh };
}
