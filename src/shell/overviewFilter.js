/**
 * The Overview's filter (#298): the subsystem a tile of its strip narrows the
 * page to, kept in the URL as `/?subsystem=nodes`. So Back undoes it, a link
 * opens the page filtered, and a reload keeps it. One subsystem at a time; a
 * value the strip doesn't show (an unconfigured subsystem, or none the model
 * knows) is no filter, and the page shows everything.
 */
import { useMemo } from 'react';
import { navigate, useSearchParam } from '../router/useRoute.js';
import { pathTo } from '../router/routes.js';
import { subsystemFilter } from './statusView.js';

/** The query parameter that holds the filter. */
export const FILTER_PARAM = 'subsystem';

/** The Overview's path, filtered to `subsystem`, or the whole page without one. */
export function overviewPath(subsystem) {
  const base = pathTo('overview');
  return subsystem ? `${base}?${FILTER_PARAM}=${encodeURIComponent(subsystem)}` : base;
}

/**
 * Filters the Overview to `subsystem`, or shows everything with null: a new
 * history entry, so Back undoes it, and the page stays where it is, under the
 * strip that set it.
 */
export function filterOverview(subsystem) {
  navigate(overviewPath(subsystem), { scroll: false });
}

/** Shows the whole Overview again: the panel's Clear, the board's note. */
export function clearOverviewFilter() {
  filterOverview(null);
}

/**
 * The subsystem the Overview is filtered to, `{ id, name }` (the model's), or
 * null: the URL's, when the strip shows it.
 */
export function useOverviewFilter(status) {
  const id = useSearchParam(FILTER_PARAM);
  return useMemo(() => subsystemFilter(status, id), [status, id]);
}
