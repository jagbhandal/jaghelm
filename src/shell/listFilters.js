/**
 * The filters of the Services and Infrastructure pages (#313), kept in the
 * page's address: `/services?state=problems&node=apps&q=jelly`. So Back undoes
 * a change, a reload keeps it, a link opens the page filtered, and a window
 * crossing 768px keeps them, path and all: below it the phone's Services tab
 * reads the same search and node (src/shell/PhoneView.jsx).
 *
 *   q      the search: each of its words somewhere in what a row is
 *          searched by (a service's name, node, custom group, container)
 *   state  what a row is drawn in: problems (critical, warning or no
 *          signal: the model's issues), ok, maintenance, no-signal
 *   node   a node's key (the Services page)
 *   tag    a service's tag (the Services page, once services have tags, #519)
 *   role   a node's role, services.yaml's subtitle (the Infrastructure page)
 *
 * A value the page doesn't know (a state it has no such filter for) is no
 * filter. Other parameters (an open entity, `?entity=`) stay as they are.
 *
 *   useListFilters(keys)    the filters in the address, and what changes
 *                           them there: a new history entry, or with
 *                           { replace } the one open; the page doesn't scroll
 *   useSearchDraft(q, fn)   the search box's text, committed to `q` once
 *                           typing stops
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigate, useLocationSearch } from '../router/useRoute.js';

/** The longest search kept. */
export const MAX_SEARCH = 100;

/** Each state filter, by its value in the address, and the drawn states it keeps. */
export const STATE_FILTERS = Object.freeze({
  problems: Object.freeze(['crit', 'warn', 'unknown']),
  ok: Object.freeze(['ok']),
  maintenance: Object.freeze(['maintenance']),
  'no-signal': Object.freeze(['unknown']),
});

/** The filters each page reads. */
export const SERVICE_FILTERS = Object.freeze(['q', 'state', 'node', 'tag']);
export const NODE_FILTERS = Object.freeze(['q', 'state', 'role']);

const ALL_KEYS = ['q', 'state', 'node', 'tag', 'role'];

const clean = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_SEARCH) : '');

/**
 * The filters `search` (a URL's query) holds, of `keys`: `q` a string ('' for
 * none), each other the value or null.
 *
 * @param {string} search
 * @param {ReadonlyArray<string>} keys
 */
export function readListFilters(search, keys = ALL_KEYS) {
  const params = new URLSearchParams(search);
  const out = {};
  for (const key of keys) {
    const value = clean(params.get(key));
    if (key === 'q') out.q = value;
    else if (key === 'state') out.state = Object.hasOwn(STATE_FILTERS, value) ? value : null;
    else out[key] = value || null;
  }
  return out;
}

/** Whether `filters` narrow anything. */
export function hasListFilters(filters) {
  return Object.entries(filters).some(([, v]) => v != null && v !== '');
}

/** A raw `name=value` part's name, decoded (null when it can't be). */
function nameOf(part) {
  try {
    return decodeURIComponent(part.split('=')[0].replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/**
 * The query `search` with its filters of `keys` replaced by `filters` (""
 * when nothing is left): the other parameters stay before them, as they were
 * written (an entity's id keeps its `/` and `:`, #309).
 */
export function listFiltersSearch(filters, search, keys = ALL_KEYS) {
  const rest = String(search ?? '')
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part && !keys.includes(nameOf(part)));
  const mine = new URLSearchParams();
  for (const key of keys) {
    const value = clean(filters[key] ?? '');
    if (value) mine.set(key, value);
  }
  const query = [...rest, mine.toString()].filter(Boolean).join('&');
  return query ? `?${query}` : '';
}

/** Whether drawn state `state` is one the state filter `filter` keeps (none keeps every one). */
export function stateMatches(filter, state) {
  if (!filter || !Object.hasOwn(STATE_FILTERS, filter)) return true;
  return STATE_FILTERS[filter].includes(state);
}

/**
 * Whether each word of `query` is in one of `fields` (any case); an empty
 * query matches everything.
 *
 * @param {string} query
 * @param {Array<string | null | undefined>} fields
 */
export function searchMatches(query, fields) {
  const words = clean(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fields
    .filter((f) => typeof f === 'string' && f)
    .join('\n')
    .toLowerCase();
  return words.every((w) => text.includes(w));
}

/**
 * The filters of `keys` in the address, and `setFilters(patch, { replace })`,
 * which changes those `patch` names: a new history entry (Back undoes it),
 * or the one open with `replace` (a search being refined). The page stays
 * where it is.
 *
 * @param {ReadonlyArray<string>} keys
 */
export function useListFilters(keys) {
  const search = useLocationSearch();
  const keysKey = keys.join();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keysKey is keys
  const filters = useMemo(() => readListFilters(search, keys), [search, keysKey]);
  const setFilters = useCallback(
    (patch, { replace = false } = {}) => {
      const { pathname, search: now, hash } = window.location;
      const next = { ...readListFilters(now, keys), ...patch };
      navigate(`${pathname}${listFiltersSearch(next, now, keys)}${hash}`, {
        replace,
        scroll: false,
        // A replaced entry keeps what it held (an entity's sheets, #309).
        state: replace ? window.history.state : null,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keysKey is keys
    [keysKey]
  );
  return [filters, setFilters];
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
    const want = clean(text);
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
