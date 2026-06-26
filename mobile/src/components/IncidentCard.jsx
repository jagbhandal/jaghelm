import React from 'react';
import UptimeLine from './UptimeLine.jsx';

/**
 * An expanded incident: title, node tag, cause, 24h uptime (the per-service
 * uptime24 scalar — there is no per-service 24h SERIES from the server), and a
 * read-only Open action. Alarm-tinted (red border). onOpen(target) only.
 */
export default function IncidentCard({ incident, onOpen }) {
  return (
    <article className="incident-card">
      <div className="incident-card__head">
        <span className="incident-card__title">{incident.title}</span>
        <span className="incident-card__node">{incident.node}</span>
      </div>
      <p className="incident-card__cause">{incident.cause}</p>
      <div className="incident-card__foot">
        <UptimeLine uptime24={incident.uptime24} />
        {incident.target?.url && (
          <button type="button" className="open-btn" onClick={() => onOpen(incident.target)}>Open</button>
        )}
      </div>
    </article>
  );
}
