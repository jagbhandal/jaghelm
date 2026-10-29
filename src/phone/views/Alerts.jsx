import React, { useMemo } from 'react';
import { AlertHistory } from '@ui/alert-history';
import { Banner } from '@ui/banner';
import { IssueRow } from '@ui/issue-row';
import { Select } from '@ui/select';
import { EMPTY, WORDS } from '@ui/lib/status.js';
import FilterChips from '../components/FilterChips.jsx';
import SearchBar from '../components/SearchBar.jsx';
import StatusBanner from '../components/StatusBanner.jsx';
import { FRESH, issueRowsOf } from '../data/board.js';
import { entityRoute } from '../nav/entityRoute.js';
import { issueRows } from '../../shell/statusView.js';
import { lastKnownCaption } from '../../shell/statusFreshness.js';
import { useUrlAlertFilters } from '../../shell/alertsFilter.js';
import { useSearchDraft } from '../../shell/listFilters.js';
import { useAlertHistory } from '../../shell/useAlertHistory.js';
import {
  KIND_OPTIONS,
  SEVERITY_OPTIONS,
  filterSummary,
  historyView,
  issueMatches,
} from '../../shell/alertsView.js';

const SEVERITY_CHIPS = [{ id: 'all', label: 'All' }, ...SEVERITY_OPTIONS];
const KIND_CHIPS = [{ id: 'all', label: 'Everything' }, ...KIND_OPTIONS];
const chipOf = (value) => value ?? 'all';
const valueOf = (chip) => (chip === 'all' ? null : chip);

/**
 * What the page shows from the data and the filters: the active rows the
 * filters leave (each opening its detail), the words for none, and History's
 * days.
 */
function useAlertsView({ data, nav, filters, history, now }) {
  const { status } = data;
  const freshness = data.freshness ?? FRESH;
  const summary = filterSummary(filters);
  const rows = useMemo(() => {
    const drawn = issueRowsOf({ status, freshness });
    const issues = status?.issues ?? [];
    return issueRows(status)
      .map((row, i) => ({
        ...row,
        incident: drawn[i],
        state: drawn[i].state,
        onOpen: () => nav.push('incident', { id: row.id }),
      }))
      .filter((_, i) => issueMatches(issues[i], filters));
  }, [status, freshness, nav, filters]);
  const days = useMemo(
    () =>
      historyView(history.events, status, now ?? Date.now(), (id, { drive } = {}) => ({
        onOpen: () => {
          // The detail each kind opens, as everywhere (a service's, a node's, else the incident's).
          const route = entityRoute(id) ?? { screen: 'incident', params: { id } };
          // A drive's alert opens its node with the drive marked (#728).
          nav.push(route.screen, drive ? { ...route.params, drive } : route.params);
        },
      })),
    [history.events, status, now, nav]
  );
  const issues = status?.issues?.length ?? 0;
  return {
    freshness,
    rows,
    days,
    // Some issues, none left by the filters.
    noMatch: summary && issues > 0 && rows.length === 0 ? `No active ${summary}` : null,
    empty: summary
      ? `No ${summary} in the last 30 days.`
      : 'No alerts in the last 30 days. Every change is recorded here, whether or not push is set up.',
  };
}

const KIND_ITEMS = KIND_CHIPS.map((c) => ({ value: c.id, label: c.label }));

/**
 * The filters, two lines at 390px: the severity chips, then the
 * search with the kind as a Select beside it (eight kinds as chips wrapped
 * to three more lines).
 */
function WebAlertFilters({ filters, onFilters }) {
  const [text, setText] = useSearchDraft(filters.q, (q, options) =>
    onFilters({ ...filters, q }, options)
  );
  return (
    <>
      <FilterChips
        label="Severity"
        chips={SEVERITY_CHIPS}
        active={chipOf(filters.severity)}
        onChange={(chip) => onFilters({ ...filters, severity: valueOf(chip) })}
      />
      <div data-slot="alert-search" className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchBar value={text} onChange={setText} placeholder="Search alerts" />
        </div>
        <Select
          aria-label="Kind"
          items={KIND_ITEMS}
          value={chipOf(filters.kind)}
          onValueChange={(v) => onFilters({ ...filters, kind: valueOf(v) })}
          className="h-11 w-36 shrink-0 text-body"
        />
      </div>
    </>
  );
}

/**
 * Alerts (#314): what is wrong now, and what happened, from the same code on
 * the web below 768px.
 *
 *  - Active: the status model's issues (#325), worst first, as compact rows:
 *    the name, where it is ("Service · vm103") and the model's reason (Bug
 *    #8). While the status is stale (#480), as on the web's Alerts page, the
 *    rows stay as last known, but none is active: each is drawn steel (no
 *    signal), under a "Last known 3 min ago" heading, and the page says "No
 *    signal · <why>" above them. Bug #4: stale data never reads as live.
 *  - History: the alert history (/api/events, #267), newest first, by day:
 *    each event's time, entity, change, reason, and what the phones got
 *    (src/shell/useAlertHistory.js, alertsView.js). Every event, whether or
 *    not push is set up. An event is not an issue: one that opened an active
 *    issue is listed in both. A failed read says so, never "nothing
 *    happened".
 *
 * One set of filters over both: severity, kind of entity and a search
 * (alertsView.js). The filters live in the page's address (Back undoes
 * one, a link opens the tab filtered). Active filters the status in
 * hand; History asks the server.
 *
 * Each row opens its detail (`nav.push`); a history row the detail its
 * entity's kind opens (entityRoute.js: a service's, a node's, else the
 * incident's), where one the model no longer has says so.
 *
 * The page (#303): the page's title, the severity chips, the search with
 * the kind beside it as a Select, the issues as the shared issue rows under
 * "Active" (or "Last known 3 min ago"), and History as the shared
 * AlertHistory. No gear.
 */
export default function Alerts({ data, nav }) {
  const [filters, setFilters] = useUrlAlertFilters();
  const history = useAlertHistory(filters, { updated: data.updated });
  return (
    <WebAlertsView
      data={data}
      nav={nav}
      filters={filters}
      onFilters={setFilters}
      history={history}
    />
  );
}

/**
 * The page from what it is given (the gallery draws it): the screen's
 * `data` and `nav`, the filters and what changes them, History
 * (useAlertHistory's) and `now`, the clock its days are told by.
 */
export function WebAlertsView({ data, nav, filters, onFilters, history, now }) {
  const { loading, error, servicesBody, status } = data;
  const { freshness, rows, days, noMatch, empty } = useAlertsView({
    data,
    nav,
    filters,
    history,
    now,
  });
  const stale = freshness.stale;
  const heading = 'text-overline text-text-3 uppercase';
  const quiet = !loading && !error && !stale && status && (status.issues ?? []).length === 0;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title">Alerts</h1>
      <StatusBanner loading={loading} error={error} hasData={!!servicesBody} />
      <WebAlertFilters filters={filters} onFilters={onFilters} />
      {stale && !error && <Banner tone="unknown" title={WORDS.unknown} cause={freshness.cause} />}
      <section aria-label={stale ? 'Last known' : 'Active'} className="flex flex-col gap-2">
        <h2 className={heading}>
          {stale ? (lastKnownCaption(freshness) ?? 'Last known') : 'Active'}
        </h2>
        {quiet && (
          <p className="rounded-xl border border-border bg-surface-1 px-panel py-3.5 text-text-2">
            {status.overall.state === EMPTY
              ? status.overall.sentence
              : 'All clear — nothing is on fire.'}
          </p>
        )}
        {noMatch && (
          <p className="rounded-xl border border-border bg-surface-1 px-panel py-3.5 text-text-2">
            {noMatch}
          </p>
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1">
            {rows.map((row) => (
              <li key={row.id}>
                <IssueRow issue={row} onOpen={row.onOpen} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <AlertHistory
        heading="overline"
        state={history.state}
        days={days}
        failed={history.failed}
        onRetry={history.retry}
        onMore={history.more ?? undefined}
        loadingMore={history.loadingMore}
        empty={empty}
      />
    </div>
  );
}
