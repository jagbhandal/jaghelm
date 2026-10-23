/**
 * Where the Alerts pages keep their filters (#314, alertsView.js): on the web,
 * in the page's address (`/alerts?severity=critical&kind=services&q=jelly`),
 * so Back undoes a change, a reload keeps it, and a link opens the page
 * filtered; in the Android app, which has no address, in the screen.
 *
 * Both give `[filters, setFilters]`; `setFilters(next, { replace })` on the
 * web pushes a history entry, or replaces the one open (the search as it is
 * typed refines the last one), and leaves the page where it is.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigate, useLocationSearch } from '../router/useRoute.js';
import { MAX_SEARCH, NO_FILTERS, alertFiltersSearch, readAlertFilters } from './alertsView.js';

/** The filters in the address, and what changes them there. */
export function useUrlAlertFilters() {
  const search = useLocationSearch();
  const filters = useMemo(() => readAlertFilters(search), [search]);
  const setFilters = useCallback((next, { replace = false } = {}) => {
    const { pathname, search: now, hash } = window.location;
    navigate(`${pathname}${alertFiltersSearch(next, now)}${hash}`, { replace, scroll: false });
  }, []);
  return [filters, setFilters];
}

/** The filters in the screen (the Android app's), none to start with. */
export function useStateAlertFilters() {
  const [filters, setFilters] = useState(NO_FILTERS);
  return [filters, useCallback((next) => setFilters(next), [])];
}

/** How long the search waits after the last key before it filters. */
export const SEARCH_DELAY_MS = 300;

/**
 * The search box's text, kept apart from the filter it commits (`q`), so a
 * key typed is drawn at once and the page filters (and History asks the
 * server) once typing stops. `onCommit(q, { replace })` is called with the
 * trimmed text: replacing the entry open while one search is refined, a new
 * entry when one starts or is cleared. A `q` changed from elsewhere (Back,
 * Clear) becomes the text.
 *
 * @param {string} q
 * @param {(q: string, options: { replace: boolean }) => void} onCommit
 * @returns {[string, (text: string) => void]}
 */
export function useSearchDraft(q, onCommit) {
  const [text, setText] = useState(q);
  const committed = useRef(q);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(() => {
    if (q === committed.current) return;
    committed.current = q;
    setText(q);
  }, [q]);

  useEffect(() => {
    const want = text.trim().slice(0, MAX_SEARCH);
    if (want === committed.current) return undefined;
    const timer = setTimeout(() => {
      const was = committed.current;
      committed.current = want;
      commit.current(want, { replace: was !== '' && want !== '' });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return [text, setText];
}
