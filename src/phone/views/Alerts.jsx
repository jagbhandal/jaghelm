import React, { useMemo } from 'react';
import { Banner } from '@ui/banner';
import { IssueRow } from '@ui/issue-row';
import { EMPTY, WORDS } from '@ui/lib/status.js';
import { groupByDay, formatDayLabel, dateToDayKey } from '../data/groupByDay.js';
import StatusBanner from '../components/StatusBanner.jsx';
import { FRESH, issueRowsOf } from '../data/board.js';
import { issueRows } from '../../shell/statusView.js';
import { lastKnownCaption } from '../../shell/statusFreshness.js';

/**
 * Alerts: the status model's issues (#325), worst first, are pinned at top in
 * alarm-red as the active incidents, shown as compact rows: the name, where it
 * is ("Service · vm103") and the model's reason (Bug #8).
 *
 * While the status is stale (#480), as on the web's Alerts page, the rows stay
 * as last known, but none is active: each is drawn steel (no signal), under a
 * "Last known 3 min ago" heading, and the page says "No signal · <why>" above
 * them ("JagHelm's status is out of date"; a fetch error's own banner says it
 * when the cards can't be read either). Bug #4: stale data never reads as live.
 *
 * History de-dup (Bug #3): history renders ONLY incidents whose id is NOT
 * active. Every issue the model has now IS active, so the history section is
 * empty by design → shows "No earlier alerts this session."
 *
 * Day-grouping stays wired for the future persisted-history feed (Phase 5+).
 * When that feed lands, pass real persisted incidents (filtered to non-active)
 * into historyIncidents and stamp them with their real event timestamps.
 *
 * Gear → NotificationSettings: always enabled + indigo (Bug #13 partial).
 * READ-ONLY: the only action is nav.push.
 *
 * The web look (#303): the page's title; the same lines, as a Banner (no
 * signal and why) or the quiet card; the issues as the shared issue rows
 * under "Active" (or "Last known 3 min ago"), each opening its detail; and
 * History. No gear: Notification settings are the Android app's own, and
 * the web's Settings has no Notifications section yet (spec §7).
 */
export default function Alerts(props) {
  if (__ANDROID_LOOK__) return <AndroidAlerts {...props} />;
  return <WebAlerts {...props} />;
}

function WebAlerts({ data, nav }) {
  const { loading, error, servicesBody, status } = data;
  const freshness = data.freshness ?? FRESH;
  const stale = freshness.stale;
  const rows = useMemo(() => {
    const opens = issueRowsOf({ status, freshness });
    return issueRows(status).map((row, i) => ({
      ...row,
      state: opens[i].state,
      onOpen: () => nav.push('incident', { id: row.id }),
    }));
  }, [status, freshness, nav]);
  const heading = 'text-overline text-text-3 uppercase';
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title">Alerts</h1>
      <StatusBanner loading={loading} error={error} hasData={!!servicesBody} />
      {!loading && !error && !stale && status && rows.length === 0 && (
        <p className="rounded-xl border border-border bg-surface-1 px-panel py-3.5 text-text-2">
          {status.overall.state === EMPTY
            ? status.overall.sentence
            : 'All clear — nothing is on fire.'}
        </p>
      )}
      {stale && !error && <Banner tone="unknown" title={WORDS.unknown} cause={freshness.cause} />}
      {rows.length > 0 && (
        <>
          <section aria-label={stale ? 'Last known' : 'Active'} className="flex flex-col gap-2">
            <h2 className={heading}>
              {stale ? (lastKnownCaption(freshness) ?? 'Last known') : 'Active'}
            </h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1">
              {rows.map((row) => (
                <li key={row.id}>
                  <IssueRow issue={row} onOpen={row.onOpen} />
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="History" className="flex flex-col gap-2">
            <h2 className={heading}>History</h2>
            <p className="text-body-sm text-text-3">No earlier alerts this session.</p>
          </section>
        </>
      )}
    </div>
  );
}

function AndroidAlerts({ data, nav }) {
  const { loading, error, servicesBody, status } = data;
  const freshness = data.freshness ?? FRESH;
  const stale = freshness.stale;

  const incidents = useMemo(() => issueRowsOf({ status, freshness }), [status, freshness]);

  // The set of active incident ids — history filters these OUT (de-dup, Bug #3).
  const activeIds = useMemo(() => new Set(incidents.map((i) => i.id)), [incidents]);

  // History: only incidents NOT in the active set.
  // In snapshot-only mode all derived incidents are active → historyIncidents is always [].
  // When a real persisted-history feed lands (Phase 5+), non-active incidents live here.
  const historyIncidents = useMemo(
    () => incidents.filter((i) => !activeIds.has(i.id)),
    [incidents, activeIds]
  );

  const now = new Date();
  const todayKey = dateToDayKey(now);

  // Day-grouping stays wired for the future feed; currently always produces [].
  const groups = useMemo(() => {
    if (historyIncidents.length === 0) return [];
    const dated = historyIncidents.map((i) => ({ ...i, _at: now }));
    return groupByDay(dated, (i) => i._at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyIncidents]);

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

      {/* Quiet: all clear. An empty board (#449) has nothing checked, so it
          says the model's "Nothing monitored yet" instead, never all clear. */}
      {!loading && !error && !stale && status && incidents.length === 0 && (
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
      {incidents.length > 0 && (
        <>
          {stale ? (
            <h2 className="alerts-section">{lastKnownCaption(freshness) ?? 'Last known'}</h2>
          ) : (
            <h2 className="alerts-section alerts-section--active">Active</h2>
          )}
          {incidents.map((inc) => (
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

          {/* History — empty-by-design in snapshot mode (§13 decision #3) */}
          <h2 className="alerts-section">History</h2>
          {groups.length === 0 ? (
            <p className="alerts-history-empty">No earlier alerts this session.</p>
          ) : (
            groups.map((g) => (
              <div key={g.day}>
                <h2 className="alerts-section">{formatDayLabel(g.day, todayKey)}</h2>
                {g.items.map((inc) => (
                  <button
                    key={`h-${inc.id}`}
                    type="button"
                    className="alert-row"
                    onClick={() => nav.push('incident', { id: inc.id })}
                    aria-label={`${inc.title}, ${inc.readout}: ${inc.cause}`}
                  >
                    <span className="alert-row__title">{inc.title}</span>
                    <span className="alert-row__node">{inc.readout}</span>
                    <span className="alert-row__cause">{inc.cause}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </>
      )}
    </section>
  );
}
