import React, { useMemo } from 'react';
import { deriveIncidents, activeIncidentIds } from '../data/derive.js';
import { groupByDay, formatDayLabel, dateToDayKey } from '../data/groupByDay.js';
import StatusBanner from '../components/StatusBanner.jsx';

/**
 * Alerts: active (live-derived) incidents are pinned at top in alarm-red,
 * shown as compact rows that include the cause (Bug #8).
 *
 * History de-dup (Bug #3): history renders ONLY incidents whose id is NOT in
 * activeIncidentIds(). Since all currently-derived incidents ARE active, the
 * history section is empty by design → shows "No earlier alerts this session."
 *
 * Day-grouping stays wired for the future persisted-history feed (Phase 5+).
 * When that feed lands, pass real persisted incidents (filtered to non-active)
 * into historyIncidents and stamp them with their real event timestamps.
 *
 * Gear → NotificationSettings: always enabled + indigo (Bug #13 partial).
 * READ-ONLY: the only action is nav.push.
 */
export default function Alerts({ data, nav }) {
  const { loading, error, servicesBody } = data;
  const { ups, cron } = data;

  const incidents = useMemo(
    () => deriveIncidents({ services: servicesBody, ups, cron }),
    [servicesBody, ups, cron],
  );

  // The set of active incident ids — history filters these OUT (de-dup, Bug #3).
  const activeIds = useMemo(() => activeIncidentIds(incidents), [incidents]);

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

      {!loading && !error && incidents.length === 0 && (
        <p className="alerts-clear">All clear — nothing is on fire.</p>
      )}

      {incidents.length > 0 && (
        <>
          <h2 className="alerts-section alerts-section--active">Active</h2>
          {incidents.map((inc) => (
            <button
              key={inc.id}
              type="button"
              className="alert-row alert-row--active"
              onClick={() => nav.push('incident', { id: inc.id })}
              aria-label={`${inc.title} on ${inc.node} (active)`}
            >
              <span className="alert-row__title">{inc.title}</span>
              <span className="alert-row__node">{inc.node}</span>
              {/* Cause shown on active rows (Bug #8 — active cards must show cause) */}
              {inc.cause && <span className="alert-row__cause">{inc.cause}</span>}
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
                    aria-label={`${inc.title} on ${inc.node}: ${inc.cause}`}
                  >
                    <span className="alert-row__title">{inc.title}</span>
                    <span className="alert-row__node">{inc.node}</span>
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
