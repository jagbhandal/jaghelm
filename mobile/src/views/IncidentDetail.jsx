import React from 'react';
import BackHeader from '../components/BackHeader.jsx';
import StatusDot from '../components/StatusDot.jsx';
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
export default function IncidentDetail({ data, nav, params }) {
  const incidents = deriveIncidents({
    services: data.servicesBody,
    ups: data.ups,
    cron: data.cron,
  });
  const incident = incidents.find((i) => i.id === params.id);

  if (!incident) {
    return (
      <section className="mobile-view" aria-label="Incident detail">
        <BackHeader title="Incident" onBack={nav.pop} />
        <p className="mobile-view__todo">This incident has resolved.</p>
      </section>
    );
  }

  const u = incident.uptime24;
  const pct = u != null ? (u * 100).toFixed(1) : null;

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

      {pct != null && (
        <p className="detail-uptime">
          <span className="detail-uptime__label">24H uptime</span>{' '}
          <strong className="detail-uptime__value">{pct}%</strong>
        </p>
      )}

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
          className="incident-card__open"
          onClick={() => openTarget(incident.target)}
        >
          Open
        </button>
      )}
    </section>
  );
}
