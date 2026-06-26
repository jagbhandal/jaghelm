import React from 'react';
import { deriveIncidents } from '../data/derive.js';
import { groupByDay, formatDayLabel } from '../data/groupByDay.js';

/**
 * Alerts: active (live-derived) incidents are pinned at top in alarm-red.
 * Below, the same incidents are grouped by day using groupByDay + formatDayLabel
 * (Phase 3 has no persisted push history yet — the real history feed lands in
 * Phase 5; day-grouping is wired + unit-tested now so the heading is correct
 * for all future multi-day data, not hard-coded "Today").
 *
 * The notification-settings gear is rendered DISABLED/inert (Phase 5 owns it).
 * READ-ONLY: the only action here is nav.push to the incident detail screen.
 * Mute is NOT rendered.
 */
export default function Alerts({ data, nav }) {
  const incidents = deriveIncidents({
    services: data.servicesBody,
    ups: data.ups,
    cron: data.cron,
  });

  // Phase 3: stamp all derived incidents with "now" for day-grouping.
  // When Phase 5 brings a real history feed, replace `now` with the incident's
  // actual event timestamp.
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dated = incidents.map((i) => ({ ...i, _at: now }));
  const groups = groupByDay(dated, (i) => i._at);

  return (
    <section className="mobile-view" aria-label="Alerts">
      <div className="alerts-head">
        <h1>Alerts</h1>
        <button
          type="button"
          className="alerts-gear"
          aria-label="Notification settings (coming soon)"
          disabled
          title="Coming soon"
        >
          ⚙
        </button>
      </div>

      {incidents.length === 0 && (
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
              aria-label={`${inc.title} on ${inc.node}`}
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
                  aria-label={`${inc.node}: ${inc.cause}`}
                >
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
