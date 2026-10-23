/**
 * Filters kept in the page's address, one implementation for every list page
 * (#313): the Services and Infrastructure pages
 * (`/services?state=problems&node=apps&q=jelly`), the Alerts page and the
 * phone's Alerts tab (#314, `/alerts?severity=critical&kind=services`,
 * alertsFilter.js) and the phone's Services tab. So Back undoes a change, a
 * reload keeps it, a link opens the page filtered, and a window crossing
 * 768px keeps them. What a query holds and what a filter keeps is
 * filterQuery.js (pure); these are the hooks.
 *
 *   useUrlFilters(read, keys)  the filters `read` finds in the address, and
 *                              what changes those of `keys` there: a new
 *                              history entry, or with { replace } the one
 *                              open, keeping what it held (an entity's
 *                              sheets, #309); other parameters stay as
 *                              written; the page doesn't scroll
 *   useListFilters(keys)       the same for the list pages' own filters
 *   useSearchDraft(q, fn)      the search box's text, committed to `q` once
 *                              typing stops
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigate, useLocationSearch } from '../router/useRoute.js';
import { MAX_SEARCH, listFiltersSearch, readListFilters } from './filterQuery.js';

export * from './filterQuery.js';

/**
 * The filters `read` finds in the address (`read(search)`: the page's own
 * reader, which drops what it doesn't know), and `setFilters(patch, {
 * replace })`, which changes those `patch` names: the filters are kept in the
 * parameters `keys`. A change is a new history entry (Back undoes it), or the
 * one open with `replace` (a search being refined), which keeps what it held
 * (an entity's sheets, #309). The other parameters stay as written (an
 * entity's id keeps its `/` and `:`); the page stays where it is. `read`
 * should keep its identity (a module's function, or a memoised one).
 *
 * @template F
 * @param {(search: string) => F} read
 * @param {ReadonlyArray<string>} keys
 * @returns {[F, (patch: Partial<F>, options?: { replace?: boolean }) => void]}
 */
export function useUrlFilters(read, keys) {
  const search = useLocationSearch();
  const keysKey = keys.join();
  const filters = useMemo(() => read(search), [read, search]);
  const setFilters = useCallback(
    (patch, { replace = false } = {}) => {
      const { pathname, search: now, hash } = window.location;
      const next = { ...read(now), ...patch };
      navigate(`${pathname}${listFiltersSearch(next, now, keysKey.split(','))}${hash}`, {
        replace,
        scroll: false,
        state: replace ? window.history.state : null,
      });
    },
    [read, keysKey]
  );
  return [filters, setFilters];
}

/** The list pages' own filters of `keys` (filterQuery.js) in the address, as useUrlFilters keeps them. */
export function useListFilters(keys) {
  const keysKey = keys.join();
  const read = useCallback((search) => readListFilters(search, keysKey.split(',')), [keysKey]);
  return useUrlFilters(read, keys);
}

/** How long the search waits after the last key before it goes into the address. */
export const SEARCH_DELAY_MS = 300;

/**
 * The search box's text, kept apart from the `q` it commits, so a key typed
 * is drawn (and filters the list) at once, and the address changes once
 * typing stops. `onCommit(q, { replace })` gets the trimmed text: replacing
 * the entry open while a search is refined, a new entry when one starts or is
 * cleared. A `q` changed from elsewhere (Back, Clear filters) becomes the
 * text.
 *
 * @param {string} q
 * @param {(q: string, options: { replace: boolean }) => void} onCommit
 * @returns {[string, (text: string) => void]}
 */
export function useSearchDraft(q, onCommit) {
  const [text, setText] = useState(q);
  const committed = useRef(q);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });

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
