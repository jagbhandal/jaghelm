/**
 * The Alerts page (#296, #314): what is wrong now, and what happened.
 *
 *  - Active: the status model's issues, worst first, as the attention panel
 *    and its issue rows draw them (ShellAttention, which the Overview's top
 *    shares, #297). Without a signal it says so and still shows what the
 *    server last said, so a blip doesn't blank the list.
 *  - History: the alert history (/api/events, #267), newest first, by day:
 *    each event's time, entity, change, reason, and what the phones got
 *    (AlertHistory). Push off still records every event (#267), so History
 *    works without push. A failed read says so, never "nothing happened".
 *
 * One set of filters over both, in the page's address (alertsFilter.js):
 * severity, kind of entity and a search, so Back undoes a change and a link
 * opens the page filtered. Active filters the status in hand; History asks
 * the server with them (alertsView.js says why). Each row opens its entity's
 * detail over the page (its URL, #309, useEntityLink), the filters kept
 * under it; one the model no longer has says "No longer monitored".
 *
 * AlertsPageView is the page drawn from what it is given (AlertsContent, its
 * content, is what the gallery draws); the default export wires it to the
 * address and the server.
 */
import { useMemo } from 'react';
import { ShellPage } from '@ui/app-shell';
import { AlertFilters } from '@ui/alert-filters';
import { AlertHistory } from '@ui/alert-history';
import { ShellAttention } from './ShellAttention.jsx';
import { useEntityLink } from './entityNav.js';
import { useSearchDraft, useUrlAlertFilters } from './alertsFilter.js';
import { useAlertHistory } from './useAlertHistory.js';
import {
  KIND_OPTIONS,
  NO_FILTERS,
  SEVERITY_OPTIONS,
  filterSummary,
  hasFilters,
  historyView,
  issueMatches,
} from './alertsView.js';

const ALL = 'all';
const SEVERITY_ITEMS = [
  { value: ALL, label: 'All' },
  ...SEVERITY_OPTIONS.map((o) => ({ value: o.id, label: o.label })),
];
const KIND_ITEMS = [
  { value: ALL, label: 'Everything' },
  ...KIND_OPTIONS.map((o) => ({ value: o.id, label: o.label })),
];

/**
 * The filters' controls (src/ui AlertFilters), wired to the filters: the
 * search waits for typing to stop (useSearchDraft).
 */
export function AlertsFilterBar({ filters, onFilters }) {
  const [text, setText] = useSearchDraft(filters.q, (q, options) =>
    onFilters({ ...filters, q }, options)
  );
  return (
    <AlertFilters
      severity={filters.severity ?? ALL}
      kind={filters.kind ?? ALL}
      search={text}
      severities={SEVERITY_ITEMS}
      kinds={KIND_ITEMS}
      onSeverity={(v) => onFilters({ ...filters, severity: v === ALL ? null : v })}
      onKind={(v) => onFilters({ ...filters, kind: v === ALL ? null : v })}
      onSearch={setText}
      onClear={hasFilters(filters) ? () => onFilters(NO_FILTERS) : undefined}
    />
  );
}

/**
 * The page's content from what it is given: the header's poll (`status`,
 * `reach`, `updated`), the filters and what changes them, History
 * (useAlertHistory's), `linkOf` (an entity id to its row's `{ href, onOpen }`)
 * and `now`, the clock History's days are told by. The gallery draws it.
 */
export function AlertsContent({
  status,
  reach,
  updated,
  filters,
  onFilters,
  history,
  linkOf,
  now,
}) {
  const summary = filterSummary(filters);
  const match = useMemo(
    () =>
      summary
        ? {
            test: (issue) => issueMatches(issue, filters),
            name: summary,
            noMatch: `No active ${summary}`,
            onClear: () => onFilters(NO_FILTERS),
          }
        : null,
    [summary, filters, onFilters]
  );
  const days = useMemo(
    () => historyView(history.events, status, now ?? Date.now(), linkOf),
    [history.events, status, linkOf, now]
  );
  return (
    <>
      <AlertsFilterBar filters={filters} onFilters={onFilters} />
      <ShellAttention
        status={status}
        reach={reach}
        updated={updated}
        linkOf={(entity) => linkOf(entity.id)}
        match={match}
        busyLabel="Loading alerts"
      />
      <AlertHistory
        state={history.state}
        days={days}
        failed={history.failed}
        onRetry={history.retry}
        onMore={history.more ?? undefined}
        loadingMore={history.loadingMore}
        empty={
          summary
            ? `No ${summary} in the last 30 days.`
            : 'No alerts in the last 30 days. Every change is recorded here, whether or not push is set up.'
        }
      />
    </>
  );
}

/** The page: its title, then its content (AlertsContent). */
export function AlertsPageView(props) {
  return (
    <ShellPage
      title="Alerts"
      description="What needs attention now, worst first, and what happened in the last 30 days."
    >
      <AlertsContent {...props} />
    </ShellPage>
  );
}

export default function AlertsPage({ status, reach, updated }) {
  const [filters, setFilters] = useUrlAlertFilters();
  const history = useAlertHistory(filters, { updated });
  const linkOf = useEntityLink();
  return (
    <AlertsPageView
      status={status}
      reach={reach}
      updated={updated}
      filters={filters}
      onFilters={setFilters}
      history={history}
      linkOf={linkOf}
    />
  );
}
