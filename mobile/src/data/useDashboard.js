import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { App } from '@capacitor/app';
import {
  getServices,
  getStatus,
  getDisplayConfig,
  NOT_MODIFIED_NO_BODY,
} from '@shared/hooks/useData.js';
import { builtAtOf, isStatus, staleAfterMs } from '@shared/hooks/useStatus.js';
import { createPollScheduler } from './pollScheduler.js';

// Fallback cadence when the display config can't be read. Matches the web
// dashboard's own default (config.refreshInterval || 30).
const DEFAULT_REFRESH_MS = 30000;
// Floor so a misconfigured tiny interval can't hammer the backend.
const MIN_REFRESH_MS = 5000;

// Whether a fetch result carries a body to apply. A 304 hands back the SAME
// reference as the last 200 (useData.js), so applying it is a no-op setState;
// the cold-start 304 sentinel carries nothing.
const hasBody = (v) => v != null && v !== NOT_MODIFIED_NO_BODY;

/** A tiny store of one value, for useSyncExternalStore (as useStatus.js keeps its own). */
function createStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** A settled promise's value or error, so one failed read can't hide the other. */
const settle = (promise) => promise.then((value) => ({ value }), (err) => ({ err }));

/**
 * The single live-data source for the mobile screens (#325): two reads a
 * round, the status model and the node and service cards.
 *
 *   /api/status    the server's judgement of everything (docs/ARCHITECTURE.md
 *                  §4.7): the overall state and sentence, the subsystems, the
 *                  ranked issues and every entity's state, word and reason.
 *                  The app judges nothing itself (spec §6); the screens draw
 *                  this. Read as the web's header reads it (useStatus.js):
 *                  `status` is the last one the server sent, kept while it
 *                  can't be reached; `reach` is 'loading' before the first
 *                  answer, 'ok', 'waiting' (a 503 before the server's first
 *                  check or past its TTL, or a body with no status) or 'down';
 *                  `updated` is when the last answer came, as a store, with
 *                  `staleAfter` and `builtAt` (#480, #499). MobileApp feeds the
 *                  three to the web's own rule for a stale status
 *                  (src/shell/statusFreshness.js).
 *   /api/services  the cards: names, icons, links, ping, uptime and each
 *                  node's readings, which the model values but doesn't carry.
 *                  It is the health gate: if it throws, `error` is set.
 *
 * `/api/ups` and `/api/cron/status` are no longer read: the model says what
 * the app drew from them (the Power, Jobs and Backups subsystems and their
 * issues), so a round costs two requests, not three.
 *
 * One poll scheduler (pollScheduler.js) drives every fetch round, by reason:
 *   'force'  — the first load and a tap on the status bar: full bodies
 *              (skipEtag), past any HTTP cache.
 *   'poll'   — every refresh interval: If-None-Match, so an unchanged source
 *              is a bodiless 304 that keeps the current reference (no data
 *              re-render, derived memos hold).
 *   'resume' — the app came back to the foreground: conditional too (a
 *              conditional request is never answered from an HTTP cache).
 * The scheduler stops when the app goes to the background (Capacitor
 * `appStateChange`) and runs one round at once on return. The same event sets
 * `foreground`, which pauses the status bar's 1 s countdown in the background.
 *
 * The refresh cadence is read from the server's dashboard config so the mobile
 * countdown stays in lockstep with the web app's auto-refresh. `lastUpdated`
 * (ms epoch of the last round whose cards the server answered, 200 or 304) +
 * `intervalMs` drive the status bar's "HH:MM · next Ys": the next poll is armed
 * one interval after a round lands, and a failed round doesn't move the clock.
 */
export function useDashboard() {
  const [servicesBody, setServicesBody] = useState(null);
  const [status, setStatus] = useState(null);
  const [reach, setReach] = useState('loading');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [intervalMs, setIntervalMs] = useState(DEFAULT_REFRESH_MS);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [foreground, setForeground] = useState(true);
  const [answered] = useState(() => createStore(null));
  const [built] = useState(() => createStore(null));
  const schedulerRef = useRef(null);
  // What the screens last got from /api/status, so an unchanged answer sets no state.
  const shown = useRef({ status: null, reach: 'loading' });

  // The status's clock, as useStatus.js serves it: the same store until the interval changes.
  const updated = useMemo(
    () => ({
      get: answered.get,
      subscribe: answered.subscribe,
      builtAt: built.get,
      staleAfter: staleAfterMs(intervalMs),
    }),
    [answered, built, intervalMs]
  );

  useEffect(() => {
    let live = true;

    const show = (next) => {
      const was = shown.current;
      if (next.status === was.status && next.reach === was.reach) return;
      shown.current = next;
      setStatus(next.status);
      setReach(next.reach);
    };

    // One /api/status answer, read as useStatus.js reads it.
    const applyStatus = ({ value: answer, err }) => {
      if (err) {
        const why = /HTTP 503/.test(String(err?.message)) ? 'waiting' : 'down';
        show({ status: shown.current.status, reach: why });
        return;
      }
      const at = Date.now();
      // Set first: the answer's listeners read it.
      built.set(builtAtOf(answer, at));
      const { body } = answer;
      if (body !== NOT_MODIFIED_NO_BODY) {
        show(isStatus(body) ? { status: body, reach: 'ok' } : { status: null, reach: 'waiting' });
      }
      answered.set(at);
    };

    const round = async (reason) => {
      const force = reason === 'force';
      const [s, st] = await Promise.all([settle(getServices(force)), settle(getStatus(force))]);
      if (!live) return;
      applyStatus(st);
      if (s.err) setError(s.err);
      else {
        if (hasBody(s.value)) setServicesBody(s.value);
        setError(null);
        setLastUpdated(Date.now());
      }
      setLoading(false);
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
        setForeground(isActive);
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
  }, [answered, built]);

  const refresh = useCallback(() => schedulerRef.current?.refresh('force') ?? Promise.resolve(), []);

  return {
    servicesBody,
    status,
    reach,
    updated,
    loading,
    error,
    refresh,
    intervalMs,
    lastUpdated,
    foreground,
  };
}
