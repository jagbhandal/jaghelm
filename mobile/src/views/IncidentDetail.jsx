import React from 'react';
import BackHeader from '../components/BackHeader.jsx';
import StatusDot from '../components/StatusDot.jsx';
import UptimeLine from '../components/UptimeLine.jsx';
import { deriveIncidents } from '../data/derive.js';
import { openTarget } from '../open.js';

/**
 * IncidentDetail: full detail view for a derived incident.
 * Read-only — the only action besides back is Open (deep-link to the service URL).
 * Mute is NOT rendered (Phase 5).
 * The notification gear is on the Alerts list screen, not here.
 *
 * Timeline includes:
 *  - Detected: the trigger cause
 *  - Push sent: Phase-5 placeholder (not yet wired to a real push pipeline)
 */
// Turn a differ event type ('host_unreachable') into a human title ('Host unreachable').
function humanizeType(type) {
  const s = String(type || '').replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Incident';
}

export default function IncidentDetail({ data, nav, params }) {
  const incidents = deriveIncidents({
    services: data.servicesBody,
    ups: data.ups,
    cron: data.cron,
  });
  const incident = incidents.find((i) => i.id === params.id);

  if (!incident) {
    // No live derived incident. If the deep-link carried push-event params
    // (host events have NO derived incident by design; or the incident has
    // since resolved), render a real push-event detail from those params
    // instead of a dead stub. Only when there are no params either do we show
    // the resolved copy.
    if (params.type) {
      const title = humanizeType(params.type);
      return (
        <section className="mobile-view" aria-label="Incident detail">
          {/* title is in the header only (do NOT also repeat it in a <p>, or a
              getByText(/host unreachable/i) query would match twice). */}
          <BackHeader title={title} onBack={nav.pop} />
          <div className="detail-head">
            <StatusDot status={params.severity === 'info' ? 'up' : 'down'} />
            <span className="detail-head__node">{params.node || params.fcmId}</span>
          </div>
          {params.severity && (
            <p className="push-event__severity">Severity: {params.severity}</p>
          )}
          <p className="push-event__note">
            Live status for this event is not in the current snapshot — it may have resolved.
          </p>
        </section>
      );
    }
    return (
      <section className="mobile-view" aria-label="Incident detail">
        <BackHeader title="Incident" onBack={nav.pop} />
        <p className="mobile-view__todo">This incident has resolved.</p>
      </section>
    );
  }

  // Phase 3 timeline: synthetic events derived from the incident.
  // Phase 5 will replace this with real push-event records from the server.
  // Note: "Detected" deliberately omits the cause (already shown above the timeline)
  // to avoid duplicate accessible text that breaks single-element queries.
  const events = [
    { label: 'Detected', detail: `Incident opened — ${incident.node}` },
    { label: 'Push sent', detail: 'Pending — push pipeline lands in Phase 5' },
  ];

  return (
    <section className="mobile-view" aria-label="Incident detail">
      <BackHeader title={incident.title} onBack={nav.pop} />

      <div className="detail-head">
        <StatusDot status={incident.status} />
        <span className="detail-head__node">{incident.node}</span>
      </div>

      <p className="detail-cause">{incident.cause}</p>

      <UptimeLine uptime24={incident.uptime24} />

      <h2 className="detail-section">Event timeline</h2>
      <ul className="timeline">
        {events.map((e) => (
          <li key={e.label} className="timeline__item">
            <span className="timeline__label">{e.label}</span>
            <span className="timeline__detail">{e.detail}</span>
          </li>
        ))}
      </ul>

      {incident.target?.url && (
        <button
          type="button"
          className="open-btn"
          onClick={() => openTarget(incident.target)}
        >
          Open
        </button>
      )}
    </section>
  );
}
