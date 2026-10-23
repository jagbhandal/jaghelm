/**
 * The Alerts pages' History (#314): /api/events (#267) for the filters asked
 * (alertsView.js eventsQuery: the server filters, since it keeps up to 1000
 * events and sends a page at a time), newest first, a page at a time. The
 * web's Alerts page, the phone's Alerts tab and so the Android app read it.
 *
 *   useAlertHistory(filters, { updated })
 *     -> { state, events, more, loadingMore, failed, retry }
 *
 *   state        'loading' before the first answer for these filters; 'ok';
 *                'old', a server from before /api/events (a 404: an Android
 *                app can talk to one; the web never does), which has no
 *                history to show and is not asked again this session, for
 *                any filter (oldServers); 'error', nothing
 *                could be read (a failed fetch, an answer that isn't a page).
 *                A failure is never an empty history.
 *   events       the records, newest first: the first page, then each older
 *                one loaded with `more`
 *   more         loads the next older page; null when there is none, or
 *                while the history can't be read
 *   failed       a later read failed (a refresh, an older page): `events` are
 *                what the last good answers said
 *   retry        asks again
 *
 * `updated` is the status poll's clock (useStatus.js, the Android app's
 * useDashboard), a store: on each of its answers the first page is asked
 * again, so a new event shows, and so does what push did with it ("Sending",
 * then "Sent to 2 phones"). The poll stops while the page is hidden, and so
 * does this. Pages older than the first stay as they were loaded.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getEvents } from '../hooks/useData.js';
import { getApiBase } from '../api/baseUrl.js';
import { eventsQuery } from './alertsView.js';

/** How many events a page asks for. */
export const HISTORY_PAGE = 50;

const START = Object.freeze({
  state: 'loading',
  events: [],
  next: null,
  loadingMore: false,
  failed: false,
});

/** A server without the route (#267) answers 404. */
const isOld = (err) => /HTTP 404\b/.test(String(err?.message));

/**
 * The servers (by their API base: the Android app can be pointed at another)
 * that answered 404 this session. Each is "old" from then on, for every
 * filter and every visit to the page, and never asked again until a reload:
 * a filter changed on one would otherwise ask again and flash "Loading".
 */
const oldServers = new Set();
const knownOld = () => oldServers.has(getApiBase());

/** Forget the servers found old (tests start each case afresh). */
export function forgetOldServers() {
  oldServers.clear();
}

/** Where a history starts: "old" on a server found old, else loading. */
const startOf = (key) => (knownOld() ? { key, ...START, state: 'old' } : { key, ...START });

/**
 * `view` with a new first page: older pages already loaded are kept below it
 * (each id under the page's last), and so is their cursor.
 */
function withFirstPage(view, page) {
  const cut = page.next === null ? null : Number(page.next);
  const older = cut === null ? [] : view.events.filter((e) => Number(e.id) < cut);
  return {
    ...view,
    state: 'ok',
    failed: false,
    events: [...page.events, ...older],
    next: older.length > 0 ? view.next : page.next,
  };
}

/**
 * @param {{ severity: string | null, kind: string | null, q: string }} filters
 * @param {{ updated?: { subscribe: (fn: () => void) => () => void } | null }} [options]
 */
export function useAlertHistory(filters, { updated = null } = {}) {
  const key = JSON.stringify(eventsQuery(filters));
  const [view, setView] = useState(() => startOf(key));
  // What a late answer is checked against: the filters it was asked for, and
  // whether a newer first page was asked since.
  const run = useRef({ key: null, sent: 0 });
  const shown = view.key === key ? view : startOf(key);
  const latest = useRef(shown);
  latest.current = shown;

  const first = useCallback(() => {
    if (knownOld()) return;
    const sent = ++run.current.sent;
    const fresh = () => run.current.key === key && run.current.sent === sent;
    getEvents({ ...JSON.parse(key), limit: HISTORY_PAGE }).then(
      (page) => {
        if (fresh()) setView((v) => (v.key === key ? withFirstPage(v, page) : v));
      },
      (err) => {
        if (!fresh()) return;
        setView((v) => {
          if (v.key !== key) return v;
          if (isOld(err)) {
            oldServers.add(getApiBase());
            return { ...v, ...START, state: 'old' };
          }
          return v.state === 'ok' ? { ...v, failed: true } : { ...v, state: 'error' };
        });
      }
    );
  }, [key]);

  // New filters start again: their first page, nothing of the last ones'.
  useEffect(() => {
    const r = run.current;
    r.key = key;
    setView((v) => (v.key === key ? v : startOf(key)));
    first();
    return () => {
      r.key = null;
    };
  }, [key, first]);

  // Each answer of the status poll: the first page again.
  useEffect(() => {
    if (typeof updated?.subscribe !== 'function') return undefined;
    return updated.subscribe(() => {
      if (latest.current.state !== 'old') first();
    });
  }, [updated, first]);

  const more = useCallback(() => {
    const v = latest.current;
    if (v.state !== 'ok' || !v.next || v.loadingMore) return;
    const before = v.next;
    setView((x) => (x.key === key ? { ...x, loadingMore: true } : x));
    getEvents({ ...JSON.parse(key), limit: HISTORY_PAGE, before }).then(
      (page) => {
        if (run.current.key !== key) return;
        setView((x) => {
          if (x.key !== key) return x;
          if (x.next !== before) return { ...x, loadingMore: false };
          const older = page.events.filter((e) => Number(e.id) < Number(before));
          return {
            ...x,
            loadingMore: false,
            failed: false,
            events: [...x.events, ...older],
            next: page.next,
          };
        });
      },
      () => {
        if (run.current.key !== key) return;
        setView((x) => (x.key === key ? { ...x, loadingMore: false, failed: true } : x));
      }
    );
  }, [key]);

  const retry = useCallback(() => {
    // An old server has nothing to retry (none is offered).
    if (knownOld()) return;
    setView((v) => {
      if (v.key !== key) return v;
      return v.state === 'error' ? { ...v, ...START } : { ...v, failed: false };
    });
    first();
  }, [key, first]);

  return {
    state: shown.state,
    events: shown.events,
    more: shown.state === 'ok' && shown.next ? more : null,
    loadingMore: shown.loadingMore,
    failed: shown.failed,
    retry,
  };
}
