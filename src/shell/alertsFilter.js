/**
 * Where the Alerts pages keep their filters (#314, alertsView.js): on the web,
 * in the page's address (`/alerts?severity=critical&kind=services&q=jelly`),
 * so Back undoes a change, a reload keeps it, and a link opens the page
 * filtered.
 *
 * It gives `[filters, setFilters]`; `setFilters(next, { replace })`
 * pushes a history entry, or replaces the one open (the search as it is
 * typed refines the last one), and leaves the page where it is. It is
 * the list pages' one hook (listFilters.js useUrlFilters, #313): a replaced
 * entry keeps what it held, and an open entity's id stays as written. The
 * search box waits for typing to stop with their one draft too
 * (listFilters.js useSearchDraft).
 */
import { useUrlFilters } from './listFilters.js';
import { ALERT_FILTER_KEYS, readAlertFilters } from './alertsView.js';

/** The filters in the address, and what changes them there. */
export function useUrlAlertFilters() {
  return useUrlFilters(readAlertFilters, ALERT_FILTER_KEYS);
}
