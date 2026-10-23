/**
 * Where the Alerts pages keep their filters (#314, alertsView.js): on the web,
 * in the page's address (`/alerts?severity=critical&kind=services&q=jelly`),
 * so Back undoes a change, a reload keeps it, and a link opens the page
 * filtered; in the Android app, which has no address, in the screen.
 *
 * Both give `[filters, setFilters]`; `setFilters(next, { replace })` on the
 * web pushes a history entry, or replaces the one open (the search as it is
 * typed refines the last one), and leaves the page where it is. The web's is
 * the list pages' one hook (listFilters.js useUrlFilters, #313): a replaced
 * entry keeps what it held, and an open entity's id stays as written. The
 * search box waits for typing to stop with their one draft too
 * (listFilters.js useSearchDraft).
 */
import { useCallback, useState } from 'react';
import { useUrlFilters } from './listFilters.js';
import { ALERT_FILTER_KEYS, NO_FILTERS, readAlertFilters } from './alertsView.js';

/** The filters in the address, and what changes them there. */
export function useUrlAlertFilters() {
  return useUrlFilters(readAlertFilters, ALERT_FILTER_KEYS);
}

/** The filters in the screen (the Android app's), none to start with. */
export function useStateAlertFilters() {
  const [filters, setFilters] = useState(NO_FILTERS);
  return [filters, useCallback((next) => setFilters(next), [])];
}
