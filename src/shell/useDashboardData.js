import { useState, useCallback, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import {
  getServices,
  getAllIntegrations,
  getMetricHistory,
  NOT_MODIFIED_NO_BODY,
} from '../hooks/useData.js';
import { clock, isTooOld, staleAfterMs, staleAt } from './freshness.js';
import { formatAgo } from './sourceHealth.js';
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
 * this: `error` is state but setState fires only on a status FLIP, and each
 * source's last success lives in a ref (no render) bumped on every success
 * (200 or 304), save that a source shown stale renders once when it answers
 * again, to clear its note.
 *
 * `sources[key]` is `{ error, staleNote }`: `staleNote` ("updated 5m ago",
 * the real age) once the source's last answer is stale by the client's one
 * rule (freshness.js: two polls and the request timeout, 72 s at 30 s), on
 * the one clock, which wakes the hook at the boundary and as the tab is shown
 * again or the machine wakes, as it does the header's status (#559): for the
 * same answer time a note and the header's No signal come together. While a
 * note shows, its age moves on the same clock. Time the Overview spent on
 * another page with the tab showing isn't silence (it asked nothing, while
 * the header's poll went on): back, its silence counts from then, unless the
 * source is failing. A hidden tab or a sleeping laptop is no excuse, as for
 * the header.
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
const NONE = Object.freeze([]);
const idle = () => () => {};

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
  // rather than a possibly-stale render snapshot; the staleness judge below
  // reads it too, as the clock may call it between renders.
  const errorRef = useRef(sourceErrors);

  const lastSuccessRef = useRef(
    SOURCE_KEYS.reduce((acc, k) => {
      acc[k] = null;
      return acc;
    }, {})
  );

  // The sources the board last drew stale, and a counter that renders again
  // when one of them answers: a 304 sets no state, so its note would stay
  // until the next render (#545). A source answering on time bumps nothing,
  // so a healthy tick still draws nothing.
  const shownStaleRef = useRef([]);
  const [, setRevived] = useState(0);

  const recordSuccess = useCallback((source) => {
    lastSuccessRef.current[source] = Date.now();
    // Its boundary moved; after no answer at all, it begins.
    clock.rearm();
    if (shownStaleRef.current.includes(source)) setRevived((n) => n + 1);
    if (errorRef.current[source] !== null) {
      errorRef.current = { ...errorRef.current, [source]: null };
      setSourceErrors(errorRef.current);
    }
  }, []);

  const recordError = useCallback((source, message) => {
    const msg = message || 'Fetch failed';
    if (errorRef.current[source] !== msg) {
      const wasFailing = errorRef.current[source] !== null;
      errorRef.current = { ...errorRef.current, [source]: msg };
      setSourceErrors(errorRef.current);
      // A source that starts failing loses its excuse (below): its boundary
      // may come nearer.
      if (!wasFailing) clock.rearm();
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

  // Time the Overview spent on another page, the tab showing, isn't silence:
  // it asked nothing while the header's poll went on, so it doesn't come back
  // showing "updated 5m ago" notes before its reads land; back, each source's
  // silence counts from then. A pause in a hidden tab is no excuse: the header
  // calls its status stale as the tab is shown, and so do the notes, until the
  // answers (#559). Adjusted during render (state derived from the `active`
  // prop) so the first frame back is right.
  const [wasActive, setWasActive] = useState(active);
  const [hiddenPause, setHiddenPause] = useState(false);
  const [excusedSinceMs, setExcusedSinceMs] = useState(null);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setHiddenPause(document.hidden === true);
    else if (!hiddenPause) setExcusedSinceMs(Date.now());
  }
  const excusedRef = useRef(null);
  excusedRef.current = excusedSinceMs;

  // When each source's silence began: its last success, or the return above
  // if later, unless it is failing (its note then keeps the real age).
  const quietSince = useCallback((key) => {
    const last = lastSuccessRef.current[key];
    if (last == null) return null;
    const excused = errorRef.current[key] === null ? excusedRef.current : null;
    return excused != null && excused > last ? excused : last;
  }, []);

  // Which sources are stale, by the one rule on the one clock (freshness.js),
  // as the header's status is: the clock wakes the hook at each boundary, and
  // as the tab is shown again or the machine wakes, and it renders only when
  // the answer changes. The live refs are read each time, so a source that
  // answers every poll never reads stale.
  const staleAfter = staleAfterMs(refreshIntervalMs);
  const watch = useCallback(
    (listener) => {
      const stops = SOURCE_KEYS.map((key) =>
        clock.watch(() => staleAt(quietSince(key), staleAfter), listener)
      );
      return () => stops.forEach((stop) => stop());
    },
    [quietSince, staleAfter]
  );
  const staleKeys = useSyncExternalStore(watch, () =>
    SOURCE_KEYS.filter((key) => isTooOld(quietSince(key), staleAfter)).join()
  );
  shownStaleRef.current = staleKeys ? staleKeys.split(',') : NONE;

  // While a note shows, its age (the real one, from the last success) moves
  // on the same clock, rendering when its words change.
  const notes = useSyncExternalStore(staleKeys ? clock.subscribe : idle, () =>
    SOURCE_KEYS.map((key) =>
      staleKeys.split(',').includes(key)
        ? `updated ${formatAgo(clock.get() - lastSuccessRef.current[key])}`
        : ''
    ).join('|')
  );

  // A STABLE identity while nothing it says changes, so the downstream banner
  // and section memos hold (a healthy tick renders nothing; 304 contract).
  const sources = useMemo(() => {
    const said = notes.split('|');
    return SOURCE_KEYS.reduce((acc, key, i) => {
      acc[key] = { error: sourceErrors[key], staleNote: said[i] || null };
      return acc;
    }, {});
  }, [sourceErrors, notes]);

  return {
    serviceData,
    integrationData,
    history,
    servicesLoaded,
    sources,
    retry,
  };
}
