import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  getServices,
  getUPSStatus,
  getGiteaActivity,
  getCronStatus,
  getAllIntegrations,
  getMetricHistory,
  NOT_MODIFIED_NO_BODY,
} from '../../hooks/useData';

/**
 * Owns all dashboard data state and the periodic-refresh wiring. Fetches are
 * independent (slow endpoints don't block fast ones); the first fetch after
 * mount skips ETags for a full payload, later refreshes use ETags.
 *
 * 304-stable-identity contract (see hooks/useData.js): a 304 returns the SAME
 * reference as the prior 200, so setState(sameRef) is bailed by Object.is and
 * an all-304 tick triggers zero re-renders. Per-source health preserves this:
 * `error` is state but setState fires only on a status FLIP, and `lastSuccessMs`
 * lives in a ref (no render) bumped on every success (200 or 304).
 *
 * `retry()` (user-triggered, not per-tick) forces an immediate full re-fetch
 * that SKIPS ETags, so a recovered endpoint returns a fresh 200 body rather
 * than a 304 against a stale cache.
 */

const SOURCE_KEYS = ['services', 'ups', 'commits', 'cron', 'integrations'];

export function useDashboardData(refreshKey) {
  const [serviceData, setServiceData] = useState({ nodes: {} });
  const [ups, setUps] = useState(null);
  const [commits, setCommits] = useState([]);
  const [cronJobs, setCronJobs] = useState([]);
  const [integrationData, setIntegrationData] = useState({});
  // Metric history for the node-card sparklines. UNLIKE the sources above this is
  // intentionally NOT 304-stable — it changes every cycle (that's the trend), so
  // it re-renders the node cards each tick. Scoped to the cards: `sources`/banners
  // memos don't depend on it, so the rest of the board keeps the 304 contract.
  const [history, setHistory] = useState({});
  // True once the first /api/services request has settled (success or failure),
  // so the view can tell "no nodes yet, still loading" from "genuinely empty".
  const [servicesLoaded, setServicesLoaded] = useState(false);

  const hasLoadedRef = useRef(false);

  // Bumping retryNonce re-runs the fetch effect immediately, independent of the
  // parent's interval-driven refreshKey; forceFullRef makes that fetch skip ETags.
  const [retryNonce, setRetryNonce] = useState(0);
  const forceFullRef = useRef(false);
  const retry = useCallback(() => {
    forceFullRef.current = true;
    setRetryNonce((n) => n + 1);
  }, []);

  // Per-source error state (short string or null); set only on a status flip.
  const [sourceErrors, setSourceErrors] = useState(() =>
    SOURCE_KEYS.reduce((acc, k) => {
      acc[k] = null;
      return acc;
    }, {})
  );
  // Mirror of sourceErrors that updates synchronously, so back-to-back outcomes
  // within one tick decide "did the status flip?" against the latest value
  // rather than a possibly-stale render snapshot. Never read for rendering.
  const errorRef = useRef(sourceErrors);

  const lastSuccessRef = useRef(
    SOURCE_KEYS.reduce((acc, k) => {
      acc[k] = null;
      return acc;
    }, {})
  );

  const recordSuccess = useCallback((source) => {
    lastSuccessRef.current[source] = Date.now();
    if (errorRef.current[source] !== null) {
      errorRef.current = { ...errorRef.current, [source]: null };
      setSourceErrors(errorRef.current);
    }
  }, []);

  const recordError = useCallback((source, message) => {
    const msg = message || 'Fetch failed';
    if (errorRef.current[source] !== msg) {
      errorRef.current = { ...errorRef.current, [source]: msg };
      setSourceErrors(errorRef.current);
    }
  }, []);

  const fetchServices = useCallback(
    async (skipEtag) => {
      try {
        const data = await getServices(skipEtag);
        recordSuccess('services');
        // NOT_MODIFIED_NO_BODY (cold-start 304) and `null` carry no body to
        // apply — leave state alone but keep it a success.
        if (data !== null && data !== NOT_MODIFIED_NO_BODY) {
          setServiceData(data || { nodes: {} });
        }
      } catch (err) {
        recordError('services', err.message);
        console.warn('[dashboard] Services fetch failed:', err.message);
      } finally {
        setServicesLoaded(true);
      }
    },
    [recordSuccess, recordError]
  );

  const fetchSections = useCallback(
    async (skipEtag) => {
      const [upsData, giteaData, cronData] = await Promise.allSettled([
        getUPSStatus(skipEtag),
        getGiteaActivity(skipEtag),
        getCronStatus(skipEtag),
      ]);

      if (upsData.status === 'fulfilled') {
        recordSuccess('ups');
        if (upsData.value !== null && upsData.value !== NOT_MODIFIED_NO_BODY) {
          setUps(upsData.value);
        }
      } else {
        recordError('ups', upsData.reason?.message);
        console.warn('[dashboard] UPS fetch failed:', upsData.reason?.message);
      }

      if (giteaData.status === 'fulfilled') {
        recordSuccess('commits');
        if (giteaData.value !== null && giteaData.value !== NOT_MODIFIED_NO_BODY) {
          setCommits(giteaData.value || []);
        }
      } else {
        recordError('commits', giteaData.reason?.message);
        console.warn('[dashboard] Gitea fetch failed:', giteaData.reason?.message);
      }

      if (cronData.status === 'fulfilled') {
        recordSuccess('cron');
        if (cronData.value !== null && cronData.value !== NOT_MODIFIED_NO_BODY) {
          setCronJobs(cronData.value || []);
        }
      } else {
        recordError('cron', cronData.reason?.message);
        console.warn('[dashboard] Cron fetch failed:', cronData.reason?.message);
      }
    },
    [recordSuccess, recordError]
  );

  const fetchIntegrations = useCallback(
    async (skipEtag) => {
      try {
        const data = await getAllIntegrations(skipEtag);
        recordSuccess('integrations');
        if (data !== null && data !== NOT_MODIFIED_NO_BODY) {
          setIntegrationData(data || {});
        }
      } catch (err) {
        recordError('integrations', err.message);
        console.warn('[dashboard] Integrations fetch failed:', err.message);
      }
    },
    [recordSuccess, recordError]
  );

  // History fetch is best-effort and decorative — a failure just leaves the
  // sparklines as-is; it is never surfaced as a source error.
  const fetchHistory = useCallback(async () => {
    try {
      const data = await getMetricHistory();
      if (data && data !== NOT_MODIFIED_NO_BODY && typeof data === 'object') setHistory(data);
    } catch {
      /* sparklines are non-essential; ignore */
    }
  }, []);

  useEffect(() => {
    // Skip ETags on the very first load (empty state needs a full body) OR when
    // a retry was explicitly requested (force a fresh fetch past any stale 304).
    const skip = !hasLoadedRef.current || forceFullRef.current;
    hasLoadedRef.current = true;
    forceFullRef.current = false;
    fetchServices(skip);
    fetchSections(skip);
    fetchIntegrations(skip);
    fetchHistory();
  }, [fetchServices, fetchSections, fetchIntegrations, fetchHistory, refreshKey, retryNonce]);

  // Memoize on [sourceErrors, healthBucket] so `sources` keeps a STABLE identity
  // across unrelated re-renders (e.g. a drag tick), rebuilding only on an error
  // flip or staleness-clock tick — otherwise a fresh object every render defeats
  // the downstream banner + panel memos. (No new render triggered; 304 contract holds.)
  const healthBucket = Math.floor(Date.now() / 15000);
  const sources = useMemo(
    () =>
      SOURCE_KEYS.reduce((acc, k) => {
        acc[k] = { error: sourceErrors[k], lastSuccessMs: lastSuccessRef.current[k] };
        return acc;
      }, {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- healthBucket re-reads the live ref by design
    [sourceErrors, healthBucket]
  );

  return {
    serviceData,
    ups,
    commits,
    cronJobs,
    integrationData,
    history,
    servicesLoaded,
    sources,
    retry,
  };
}
