import React, { useMemo } from 'react';
import { EMPTY } from '@ui/lib/status.js';
import { groupByDay, formatDayLabel, dateToDayKey } from '../data/groupByDay.js';
import StatusBanner from '../components/StatusBanner.jsx';
import { FRESH, issueRowsOf } from '../data/board.js';

/**
 * Alerts: the status model's issues (#325), worst first, are pinned at top in
 * alarm-red as the active incidents, shown as compact rows: the name, where it
 * is ("Service · vm103") and the model's reason (Bug #8). While the status is
 * stale (#480) they are not shown as active: the Overview keeps them, drawn as
 * no signal.
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
 */
export default function Alerts({ data, nav }) {
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
    [incidents, activeIds],
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

      {/* While the status is stale (error, or past its TTL, #480) we do NOT
          present its incidents as currently "Active" (Bug #4: a mid-session
          outage must never render stale data as live). */}
      {!error && !stale && incidents.length > 0 && (
        <>
          <h2 className="alerts-section alerts-section--active">Active</h2>
          {incidents.map((inc) => (
            <button
              key={inc.id}
              type="button"
              className="alert-row alert-row--active"
              onClick={() => nav.push('incident', { id: inc.id })}
              aria-label={`${inc.title}, ${inc.readout} (active)`}
            >
              <span className="alert-row__title">{inc.title}</span>
              <span className="alert-row__node">{inc.readout}</span>
              {/* The model's reason, on every active row (Bug #8). */}
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
                <h2 className="alerts-section">
                  {formatDayLabel(g.day, todayKey)}
                </h2>
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
