import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getServices,
  getUPSStatus,
  getGiteaActivity,
  getCronStatus,
  getAllIntegrations,
} from '../../hooks/useData';

/**
 * Owns all dashboard data state and the periodic-refresh wiring.
 *
 * Each fetch is independent — slow endpoints don't block fast ones from
 * rendering. The first fetch after mount skips ETags so a fresh tab always
 * gets a full payload; subsequent refreshes use ETags.
 *
 * 304-stable-identity contract (see hooks/useData.js):
 *   - On 304, fetchJson returns the SAME reference it returned for the prior 200.
 *   - Calling setState(sameRef) is bailed by React via Object.is — no re-render.
 *   - The `data !== null` guards below are defensive only (cold-start 304 edge).
 * Net: a 30s tick that produces all-304 responses triggers zero re-renders
 * in the DashboardView subtree.
 *
 * `refreshKey` is bumped by the parent on every interval tick.
 */
export function useDashboardData(refreshKey) {
  const [serviceData, setServiceData] = useState({ nodes: {} });
  const [ups, setUps] = useState(null);
  const [commits, setCommits] = useState([]);
  const [cronJobs, setCronJobs] = useState([]);
  const [integrationData, setIntegrationData] = useState({});
  // True once the first /api/services request has settled (success or failure),
  // so the view can tell "no nodes yet, still loading" from "genuinely empty".
  const [servicesLoaded, setServicesLoaded] = useState(false);

  const hasLoadedRef = useRef(false);

  const fetchServices = useCallback(async (skipEtag) => {
    try {
      const data = await getServices(skipEtag);
      if (data !== null) setServiceData(data || { nodes: {} });
    } catch (err) {
      console.warn('[dashboard] Services fetch failed:', err.message);
    } finally {
      setServicesLoaded(true);
    }
  }, []);

  const fetchSections = useCallback(async (skipEtag) => {
    try {
      const [upsData, giteaData, cronData] = await Promise.allSettled([
        getUPSStatus(skipEtag),
        getGiteaActivity(skipEtag),
        getCronStatus(skipEtag),
      ]);
      if (upsData.status === 'fulfilled' && upsData.value !== null) setUps(upsData.value);
      if (giteaData.status === 'fulfilled' && giteaData.value !== null) {
        setCommits(giteaData.value || []);
      }
      if (cronData.status === 'fulfilled' && cronData.value !== null) {
        setCronJobs(cronData.value || []);
      }
    } catch (err) {
      console.warn('[dashboard] Sections fetch failed:', err.message);
    }
  }, []);

  const fetchIntegrations = useCallback(async (skipEtag) => {
    try {
      const data = await getAllIntegrations(skipEtag);
      if (data !== null) setIntegrationData(data || {});
    } catch (err) {
      console.warn('[dashboard] Integrations fetch failed:', err.message);
    }
  }, []);

  useEffect(() => {
    const skip = !hasLoadedRef.current;
    hasLoadedRef.current = true;
    fetchServices(skip);
    fetchSections(skip);
    fetchIntegrations(skip);
  }, [fetchServices, fetchSections, fetchIntegrations, refreshKey]);

  return { serviceData, ups, commits, cronJobs, integrationData, servicesLoaded };
}
