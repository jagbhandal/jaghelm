import React, { useMemo } from 'react';
import { deriveIncidents } from '../data/derive.js';
import { groupByDay, formatDayLabel, dateToDayKey } from '../data/groupByDay.js';
import StatusBanner from '../components/StatusBanner.jsx';

/**
 * Alerts: active (live-derived) incidents are pinned at top in alarm-red.
 * Below, the same incidents are grouped by day using groupByDay + formatDayLabel
 * (Phase 3 has no persisted push history yet — the real history feed lands in
 * Phase 5; day-grouping is wired + unit-tested now so the heading is correct
 * for all future multi-day data, not hard-coded "Today").
 *
 * The notification-settings gear pushes the NotificationSettings screen (Phase 5).
 * READ-ONLY: the only action here is nav.push to the incident detail screen.
 * Mute is NOT rendered.
 */
export default function Alerts({ data, nav }) {
  const { loading, error, servicesBody } = data;
  const { ups, cron } = data;
  const incidents = useMemo(
    () => deriveIncidents({ services: servicesBody, ups, cron }),
    [servicesBody, ups, cron],
  );

  // Phase 3: stamp all derived incidents with "now" for day-grouping.
  // When Phase 5 brings a real history feed, replace `now` with the incident's
  // actual event timestamp.
  const now = new Date();
  const todayKey = dateToDayKey(now);
  const groups = useMemo(() => {
    const dated = incidents.map((i) => ({ ...i, _at: now }));
    return groupByDay(dated, (i) => i._at);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidents]);

  return (
    <section className="mobile-view" aria-label="Alerts">
      <div className="alerts-head">
        <h1>Alerts</h1>
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
            </button>
          ))}

          {groups.map((g) => (
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
          ))}
        </>
      )}
    </section>
  );
}
