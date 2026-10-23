import React, { useMemo } from 'react';
import { AlertHistory } from '@ui/alert-history';
import { Banner } from '@ui/banner';
import { IssueRow } from '@ui/issue-row';
import { EMPTY, WORDS } from '@ui/lib/status.js';
import FilterChips from '../components/FilterChips.jsx';
import SearchBar from '../components/SearchBar.jsx';
import StatusBanner from '../components/StatusBanner.jsx';
import { FRESH, issueRowsOf } from '../data/board.js';
import { issueRows } from '../../shell/statusView.js';
import { lastKnownCaption } from '../../shell/statusFreshness.js';
import {
  useSearchDraft,
  useStateAlertFilters,
  useUrlAlertFilters,
} from '../../shell/alertsFilter.js';
import { useAlertHistory } from '../../shell/useAlertHistory.js';
import {
  KIND_OPTIONS,
  SEVERITY_OPTIONS,
  filterSummary,
  historyView,
  issueMatches,
} from '../../shell/alertsView.js';

/**
 * Alerts (#314): what is wrong now, and what happened, from the same code on
 * the web below 768px and in the Android app.
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
 *    happened". A server from before /api/events (the Android app can talk
 *    to one) has no history: one line says History needs a newer server, and
 *    Active is all there is; no error.
 *
 * One set of filters over both: severity, kind of entity and a search
 * (alertsView.js). The web keeps them in the page's address (Back undoes
 * one, a link opens the tab filtered); the Android app, which has none, in
 * the screen. Active filters the status in hand; History asks the server.
 *
 * Each row opens its detail (`nav.push`); an entity the model no longer has
 * says "No longer monitored" there.
 *
 * The web look (#303): the page's title, the search and the chips, the issues
 * as the shared issue rows under "Active" (or "Last known 3 min ago"), and
 * History as the shared AlertHistory. No gear: Notification settings are the
 * Android app's own. The Android look keeps its own rows and classes (no
 * redesign before #326): History's events are its alert rows, under its day
 * headings; its gear opens Notification settings.
 */
export default function Alerts(props) {
  if (__ANDROID_LOOK__) return <AndroidAlerts {...props} />;
  return <WebAlerts {...props} />;
}

const SEVERITY_CHIPS = [{ id: 'all', label: 'All' }, ...SEVERITY_OPTIONS];
const KIND_CHIPS = [{ id: 'all', label: 'Everything' }, ...KIND_OPTIONS];
const chipOf = (value) => value ?? 'all';
const valueOf = (chip) => (chip === 'all' ? null : chip);

/**
 * What both looks show from the data and the filters: the active rows the
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
      historyView(history.events, status, now ?? Date.now(), (id) => ({
        onOpen: () => nav.push('incident', { id }),
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

/** The search box and the chips: both looks', each drawn in its own. */
function AlertFilterControls({ filters, onFilters }) {
  const [text, setText] = useSearchDraft(filters.q, (q, options) =>
    onFilters({ ...filters, q }, options)
  );
  return (
    <>
      <SearchBar value={text} onChange={setText} placeholder="Search alerts" />
      <FilterChips
        label="Severity"
        chips={SEVERITY_CHIPS}
        active={chipOf(filters.severity)}
        onChange={(chip) => onFilters({ ...filters, severity: valueOf(chip) })}
      />
      <FilterChips
        label="Kind"
        chips={KIND_CHIPS}
        active={chipOf(filters.kind)}
        onChange={(chip) => onFilters({ ...filters, kind: valueOf(chip) })}
      />
    </>
  );
}

function WebAlerts({ data, nav }) {
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
 * The web look from what it is given (the gallery draws it): the screen's
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
      <AlertFilterControls filters={filters} onFilters={onFilters} />
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

function AndroidAlerts({ data, nav }) {
  const [filters, setFilters] = useStateAlertFilters();
  const history = useAlertHistory(filters, { updated: data.updated });
  const { loading, error, servicesBody, status } = data;
  const { freshness, rows, days, noMatch, empty } = useAlertsView({
    data,
    nav,
    filters,
    history,
  });
  const stale = freshness.stale;
  const quiet = !loading && !error && !stale && status && (status.issues ?? []).length === 0;

  return (
    <section className="mobile-view" aria-label="Alerts">
      <div className="alerts-head">
        <h1>Alerts</h1>
        {/* Gear always enabled + indigo chrome (Bug #13 partial; removed opacity:0.5/cursor:default) */}
        <button
          type="button"
          className="alerts-gear"
          aria-label="Notification settings"
          onClick={() => nav.push('notificationSettings')}
        >
          ⚙
        </button>
      </div>

      <StatusBanner loading={loading} error={error} hasData={!!servicesBody} />

      <AlertFilterControls filters={filters} onFilters={setFilters} />

      {/* Quiet: all clear. An empty board (#449) has nothing checked, so it
          says the model's "Nothing monitored yet" instead, never all clear. */}
      {quiet && (
        <p className="alerts-clear">
          {status.overall.state === EMPTY
            ? status.overall.sentence
            : 'All clear — nothing is on fire.'}
        </p>
      )}

      {/* Stale (#480): no signal, and why. With a fetch error the banner
          above already says it. */}
      {stale && !error && <p className="alerts-stale">{`${WORDS.unknown} · ${freshness.cause}`}</p>}

      {/* Fresh, the issues are "Active", in red. Stale, the same rows as last
          known, steel and never "Active" (Bug #4: a mid-session outage must
          never render stale data as live). */}
      {(rows.length > 0 || noMatch) &&
        (stale ? (
          <h2 className="alerts-section">{lastKnownCaption(freshness) ?? 'Last known'}</h2>
        ) : (
          <h2 className="alerts-section alerts-section--active">Active</h2>
        ))}
      {noMatch && <p className="alerts-history-empty">{noMatch}</p>}
      {rows.map(({ incident: inc }) => (
        <button
          key={inc.id}
          type="button"
          data-state={inc.state}
          className={stale ? 'alert-row alert-row--stale' : 'alert-row alert-row--active'}
          onClick={() => nav.push('incident', { id: inc.id })}
          aria-label={`${inc.title}, ${inc.readout} (${stale ? 'last known' : 'active'})`}
        >
          <span className="alert-row__title">{inc.title}</span>
          <span className="alert-row__node">{inc.readout}</span>
          {/* The model's reason, on every row (Bug #8). */}
          <span className="alert-row__cause">{inc.cause}</span>
        </button>
      ))}

      {/* History (#314): /api/events, by day, in the app's alert rows. */}
      <h2 className="alerts-section">History</h2>
      {history.state === 'loading' && <p className="alerts-history-empty">Loading the history…</p>}
      {history.state === 'old' && (
        <p className="alerts-history-empty">History needs a newer JagHelm server.</p>
      )}
      {history.state === 'error' && (
        <p className="alerts-history-empty">
          {"Couldn't load the history. Nothing here doesn't mean nothing happened. "}
          <button type="button" className="chip" onClick={history.retry}>
            Retry
          </button>
        </p>
      )}
      {history.state === 'ok' && (
        <>
          {history.failed && (
            <p className="alerts-history-empty">
              {"Couldn't refresh the history. This is what it last said. "}
              <button type="button" className="chip" onClick={history.retry}>
                Retry
              </button>
            </p>
          )}
          {days.length === 0 && <p className="alerts-history-empty">{empty}</p>}
          {days.map((day) => (
            <div key={day.day}>
              <h3 className="alerts-section">{day.label}</h3>
              {day.rows.map((row) => {
                const where = [row.where, row.gone && 'No longer monitored']
                  .filter(Boolean)
                  .join(' · ');
                const title = [row.name, row.change].filter(Boolean).join(' · ');
                const content = (
                  <>
                    <span className="alert-row__title">{title}</span>
                    <span className="alert-row__node">
                      {[where, row.time, row.delivery].filter(Boolean).join(' · ')}
                    </span>
                    {row.reason && <span className="alert-row__cause">{row.reason}</span>}
                  </>
                );
                // An event of no entity (the status check's, an Arcane notice) opens nothing.
                if (!row.onOpen) {
                  return (
                    <div key={row.id} data-state={row.state} className="alert-row">
                      {content}
                    </div>
                  );
                }
                return (
                  <button
                    key={row.id}
                    type="button"
                    data-state={row.state}
                    className="alert-row"
                    onClick={row.onOpen}
                    aria-label={[row.name, row.change, where, row.time].filter(Boolean).join(', ')}
                  >
                    {content}
                  </button>
                );
              })}
            </div>
          ))}
          {history.more && (
            <button
              type="button"
              className="chip"
              onClick={history.more}
              disabled={history.loadingMore}
            >
              {history.loadingMore ? 'Loading older…' : 'Show older'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
