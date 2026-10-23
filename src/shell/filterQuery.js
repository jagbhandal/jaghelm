/**
 * The list filters' query and what they keep (#313), pure: what a URL's
 * query holds, the query a change writes, and the state and search matches.
 * The Services and Infrastructure pages, the Alerts pages (#314, through
 * alertsView.js) and the phone's Services tab, in both its looks, read it;
 * the hooks that keep filters in the address are listFilters.js.
 *
 *   q      the search: each of its words somewhere in what a row is
 *          searched by (a service's name, node, custom group, container)
 *   state  what a row is drawn in: problems (critical, warning or no
 *          signal: the model's issues), ok, maintenance, no-signal
 *   node   a node's key (the Services page)
 *   tag    a service's tag (the Services page, once services have tags, #519)
 *   role   a node's role, services.yaml's subtitle (the Infrastructure page)
 *
 * A value a page doesn't know (a state it has no such filter for) is no
 * filter. Other parameters (an open entity, `?entity=`) stay as written.
 */

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
 * Whether an /api/services card (the phone's Services rows, src/phone/data/
 * board.js) matches `query` as the Services page's rows do (pageFilters.js):
 * each word in its name, its node's key or name, or its container.
 */
export function cardMatches(query, card) {
  return searchMatches(query, [card.display_name, card.nodeKey, card.nodeName, card.container]);
}
