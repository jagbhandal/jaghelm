import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  getServices,
  getAllIntegrations,
  getMetricHistory,
  NOT_MODIFIED_NO_BODY,
} from '../hooks/useData.js';
import { sourceBanner } from './sourceHealth.js';
import { slowReadOf } from './tickBudget.js';

/**
 * The Overview's data beside the header's status poll (#306: what the old
 * board read for its panels went with it): /api/services (the nodes' readings
 * and the services' latencies), /api/integrations (each service's headline
 * metric) and /api/history (the node cards' hour of CPU). Fetches are
 * independent (a slow endpoint doesn't hold up a fast one); the first fetch
 * after mount skips ETags for a full payload, later refreshes use ETags.
 *
 * Refresh triggers: a `tick` change is a scheduled poll, which reads
 * /api/services and /api/integrations, and /api/history on one tick in three
 * (tickBudget.js: the rail's Pipeline takes another, so no tick asks for both,
 * and a tick costs a tab at most 4 requests with the status). Every other
 * refresh reads all three: the mount load, a `refreshKey` change, retry(),
 * and resuming. While `active` is false (the Overview is off screen, or the
 * browser tab hidden) nothing is fetched; when it turns true again the
 * sources are read at once.
 *
 * 304-stable-identity contract (see hooks/useData.js): a 304 returns the SAME
 * reference as the prior 200, so setState(sameRef) is bailed by Object.is and
 * an all-304 tick triggers zero re-renders (#252). Per-source health preserves
 * this: `error` is state but setState fires only on a status FLIP, and
 * `lastSuccessMs` lives in a ref (no render) bumped on every success (200 or
 * 304), save that a source shown stale renders once when it answers again, to
 * clear its note. `sources` reads it on a clock of half the refresh interval
 * (`refreshIntervalMs`), and `healthNow` is the time the banners judge
 * staleness at, on the same clock.
 *
 * `retry()` (user-triggered, not per-tick) forces an immediate full re-fetch
 * that SKIPS ETags, so a recovered endpoint returns a fresh 200 body rather
 * than a 304 against a stale cache.
 *
 * `only` reads just those sources (of SOURCE_KEYS, and 'history'), each on
 * every refresh, the rest never: the phone's screens (#303) draw the cards
 * alone beside the status (the model carries the UPS's readings, #549), so a
 * phone's tick costs one request beside the status.
 */

const SOURCE_KEYS = ['services', 'integrations'];

export function useDashboardData(
  refreshKey,
  { tick, active = true, refreshIntervalMs = 30_000, only = null } = {}
) {
  const onlyKey = only ? only.join() : '';
  const [serviceData, setServiceData] = useState({ nodes: {} });
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

  // What the banners show now (`sources` at `healthNow`), and a counter that
  // rebuilds `sources` when a source shown stale answers again: a 304 sets no
  // state, so after a gap the tab never saw (a sleep, a stalled main thread)
  // its note would stay up to an interval longer (#545). A source answering on
  // time bumps nothing, so a healthy tick still draws nothing.
  const shownRef = useRef(null);
  const [revived, setRevived] = useState(0);

  const recordSuccess = useCallback((source) => {
    const shown = shownRef.current;
    const wasStale =
      shown != null &&
      sourceBanner(shown.sources[source], source, shown.refreshIntervalMs, shown.healthNow)
        .staleNote !== null;
    lastSuccessRef.current[source] = Date.now();
    if (wasStale) setRevived((n) => n + 1);
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
  useEffect(() => {
    if (!active) {
      pausedRef.current = true;
      return;
    }
    // Skip ETags on the very first load (empty state needs a full body) OR when
    // a retry was explicitly requested (force a fresh fetch past any stale 304).
    const skip = !hasLoadedRef.current || forceFullRef.current;
    // Only a scheduled tick leaves /api/history out on two ticks in three
    // (tickBudget.js); anything else (load, retry, manual refresh, resume)
    // refreshes every source.
    const scheduled = !skip && !pausedRef.current && tick !== lastTickRef.current;
    hasLoadedRef.current = true;
    forceFullRef.current = false;
    pausedRef.current = false;
    lastTickRef.current = tick;
    const readHistory = !scheduled || onlyKey || slowReadOf(tick) === 'history';
    const wants = (key) => !onlyKey || onlyKey.split(',').includes(key);
    if (wants('services')) fetchServices(skip);
    if (wants('integrations')) fetchIntegrations(skip);
    if (readHistory && wants('history')) fetchHistory(skip);
  }, [
    fetchServices,
    fetchIntegrations,
    fetchHistory,
    active,
    tick,
    refreshKey,
    retryNonce,
    onlyKey,
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

  // The staleness clock steps every half refresh interval (at least 1 s).
  // `sources` is rebuilt at most once a step (or on an error flip, or when a
  // stale source answers again: `revived`), so it keeps a STABLE identity
  // across unrelated re-renders and the downstream banner and section memos
  // hold; each rebuild reads the last answers then. `healthNow`,
  // the step's start, is the `now` the banners are judged at: never later than
  // that read, so a source that answers every poll never reads stale. A
  // separate 15 s read let a source that answered 2 s ago read "updated 4s ago"
  // at a 2 s interval (#545). (A healthy tick triggers no render; 304 contract
  // holds.)
  const healthStepMs = Math.max(refreshIntervalMs / 2, 1000);
  const healthStep = Math.floor(Date.now() / healthStepMs);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- healthStep re-reads the live ref by design
    [sourceErrors, healthStep, healthStepMs, resumedAtMs, revived]
  );
  const healthNow = healthStep * healthStepMs;
  shownRef.current = { sources, healthNow, refreshIntervalMs };

  return {
    serviceData,
    integrationData,
    history,
    servicesLoaded,
    sources,
    healthNow,
    retry,
  };
}
