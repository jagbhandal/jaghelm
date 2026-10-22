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
 * Refresh triggers: a `tick` change is a scheduled poll, which fetches the live
 * sources plus ONE slow source in turn (SLOW_SOURCES), so a tick costs four
 * requests rather than six. Every other refresh fetches all six: the mount load,
 * a `refreshKey` change (a manual refresh), retry(), and resuming. While
 * `active` is false (the board is off screen) nothing is fetched; when it turns
 * true again the board refreshes at once.
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

// Sources that change slowly (sparkline history, cron reports, Gitea commits):
// a scheduled tick refreshes one of them, in this order, so each refreshes once
// every SLOW_SOURCES.length ticks. Live sources (services, UPS, integrations)
// refresh on every tick.
const SLOW_SOURCES = ['history', 'cron', 'commits'];

/**
 * The time between two scheduled polls of `key` at a given refresh interval.
 * Read off the same SLOW_SOURCES rotation the fetch effect below walks (one slow
 * source per tick), so the dashboard's stale threshold, which is a number of
 * missed polls of each source, moves with any change to the rotation.
 */
export function pollPeriodMs(key, refreshIntervalMs) {
  const everyTicks = SLOW_SOURCES.includes(key) ? SLOW_SOURCES.length : 1;
  return refreshIntervalMs * everyTicks;
}

export function useDashboardData(refreshKey, { tick, active = true } = {}) {
  const [serviceData, setServiceData] = useState({ nodes: {} });
  const [ups, setUps] = useState(null);
  const [commits, setCommits] = useState([]);
  const [cronJobs, setCronJobs] = useState([]);
  const [integrationData, setIntegrationData] = useState({});
  // Metric history for the node-card sparklines. UNLIKE the sources above this
  // changes every server cycle (that's the trend), so it rarely 304s and its
  // refresh re-renders the node cards. Scoped to the cards: `sources`/banners
  // memos don't depend on it, so the rest of the board keeps the 304 contract.
  const [history, setHistory] = useState({});
  // True once the first /api/services request has settled (success or failure),
  // so the view can tell "no nodes yet, still loading" from "genuinely empty".
  const [servicesLoaded, setServicesLoaded] = useState(false);

  const hasLoadedRef = useRef(false);

  // Bumping retryNonce re-runs the fetch effect immediately, independent of the
  // parent's interval-driven `tick`; forceFullRef makes that fetch skip ETags.
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

  // Whether every source has answered, or failed, at least once since the
  // board mounted: until then its content is still coming in, and HelmGrid
  // keeps each panel at the height it last had (#302). Once true, it stays.
  const [settled, setSettled] = useState(false);
  const answeredRef = useRef(new Set());
  const markAnswered = useCallback((source) => {
    const answered = answeredRef.current;
    if (answered.has(source)) return;
    answered.add(source);
    if (answered.size === SOURCE_KEYS.length) setSettled(true);
  }, []);

  const recordSuccess = useCallback(
    (source) => {
      markAnswered(source);
      lastSuccessRef.current[source] = Date.now();
      if (errorRef.current[source] !== null) {
        errorRef.current = { ...errorRef.current, [source]: null };
        setSourceErrors(errorRef.current);
      }
    },
    [markAnswered]
  );

  const recordError = useCallback(
    (source, message) => {
      markAnswered(source);
      const msg = message || 'Fetch failed';
      if (errorRef.current[source] !== msg) {
        errorRef.current = { ...errorRef.current, [source]: msg };
        setSourceErrors(errorRef.current);
      }
    },
    [markAnswered]
  );

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

  // The three section endpoints, fetched one at a time so a tick can take any one.
  const fetchSection = useCallback(
    async (source, skipEtag) => {
      const { load, label, apply } = {
        ups: { load: getUPSStatus, label: 'UPS', apply: setUps },
        commits: { load: getGiteaActivity, label: 'Gitea', apply: (v) => setCommits(v || []) },
        cron: { load: getCronStatus, label: 'Cron', apply: (v) => setCronJobs(v || []) },
      }[source];
      try {
        const data = await load(skipEtag);
        recordSuccess(source);
        if (data !== null && data !== NOT_MODIFIED_NO_BODY) apply(data);
      } catch (err) {
        recordError(source, err?.message);
        console.warn(`[dashboard] ${label} fetch failed:`, err?.message);
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
  const fetchHistory = useCallback(async (skipEtag) => {
    try {
      const data = await getMetricHistory(skipEtag);
      if (data && data !== NOT_MODIFIED_NO_BODY && typeof data === 'object') setHistory(data);
    } catch {
      /* sparklines are non-essential; ignore */
    }
  }, []);

  const lastTickRef = useRef(tick);
  const pausedRef = useRef(false);
  const slowTurnRef = useRef(0);
  useEffect(() => {
    if (!active) {
      pausedRef.current = true;
      return;
    }
    // Skip ETags on the very first load (empty state needs a full body) OR when
    // a retry was explicitly requested (force a fresh fetch past any stale 304).
    const skip = !hasLoadedRef.current || forceFullRef.current;
    // Only a scheduled tick takes the slow sources in turn; anything else
    // (load, retry, manual refresh, resume) refreshes every source.
    const scheduled = !skip && !pausedRef.current && tick !== lastTickRef.current;
    hasLoadedRef.current = true;
    forceFullRef.current = false;
    pausedRef.current = false;
    lastTickRef.current = tick;
    let slow = null;
    if (scheduled) {
      slow = SLOW_SOURCES[slowTurnRef.current];
      slowTurnRef.current = (slowTurnRef.current + 1) % SLOW_SOURCES.length;
    }
    fetchServices(skip);
    fetchSection('ups', skip);
    fetchIntegrations(skip);
    if (!slow || slow === 'history') fetchHistory(skip);
    if (!slow || slow === 'cron') fetchSection('cron', skip);
    if (!slow || slow === 'commits') fetchSection('commits', skip);
  }, [
    fetchServices,
    fetchSection,
    fetchIntegrations,
    fetchHistory,
    active,
    tick,
    refreshKey,
    retryNonce,
  ]);

  // Time spent paused doesn't count towards a source going stale: on resume each
  // source's staleness clock restarts, so the board doesn't come back showing
  // "updated 5m ago" banners before its resume refresh lands. Adjusted during
  // render (state derived from the `active` prop) so the first frame back is right.
  const [wasActive, setWasActive] = useState(active);
  const [resumedAtMs, setResumedAtMs] = useState(null);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setResumedAtMs(Date.now());
  }

  // Memoize on [sourceErrors, healthBucket] so `sources` keeps a STABLE identity
  // across unrelated re-renders (e.g. a drag tick), rebuilding only on an error
  // flip or staleness-clock tick — otherwise a fresh object every render defeats
  // the downstream banner + panel memos. (No new render triggered; 304 contract holds.)
  const healthBucket = Math.floor(Date.now() / 15000);
  const sources = useMemo(
    () =>
      SOURCE_KEYS.reduce((acc, k) => {
        acc[k] = {
          error: sourceErrors[k],
          lastSuccessMs: lastSuccessRef.current[k],
          watchedSinceMs: resumedAtMs,
        };
        return acc;
      }, {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- healthBucket re-reads the live ref by design
    [sourceErrors, healthBucket, resumedAtMs]
  );

  return {
    serviceData,
    ups,
    commits,
    cronJobs,
    integrationData,
    history,
    servicesLoaded,
    settled,
    sources,
    retry,
  };
}
