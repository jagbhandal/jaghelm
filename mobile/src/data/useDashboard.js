import { useState, useEffect, useCallback, useRef } from 'react';
import { getServices, getUPSStatus, getCronStatus } from '@shared/hooks/useData.js';

const REFRESH_MS = 30000;

/**
 * The single live-data source for the mobile screens. Fetches the three read-only
 * endpoints on mount + every 30s. Shaping is done by derive.js; this hook only
 * holds raw bodies + loading/error. The services fetch is the health gate: if it
 * throws, `error` is set; UPS/cron failures degrade silently to last value.
 *
 * // /history (node CPU/MEM/DISK series) is fetched in Phase 5 when the Sparkline lands — omitted here to avoid a 30s poll nobody reads.
 */
export function useDashboard() {
  const [state, setState] = useState({ servicesBody: null, ups: null, cron: null, loading: true, error: null });
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
