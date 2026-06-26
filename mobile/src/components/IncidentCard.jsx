import React from 'react';

/**
 * An expanded incident: title, node tag, cause, 24h uptime (the per-service
 * uptime24 scalar — there is no per-service 24h SERIES from the server), and a
 * read-only Open action. Alarm-tinted (red border). onOpen(target) only.
 */
export default function IncidentCard({ incident, onOpen }) {
  const u = incident.uptime24;
  const pct = u != null ? (u * 100).toFixed(1) : null;
  const pctColor = u == null ? 'var(--text-muted)' : u > 0.99 ? 'var(--green)' : u > 0.95 ? 'var(--amber)' : 'var(--red)';
  return (
    <article className="incident-card">
      <div className="incident-card__head">
        <span className="incident-card__title">{incident.title}</span>
        <span className="incident-card__node">{incident.node}</span>
      </div>
      <p className="incident-card__cause">{incident.cause}</p>
      <div className="incident-card__foot">
        {pct != null && (
          <span className="incident-card__uptime">
            <span className="incident-card__uptime-label">24H</span>
            <span style={{ color: pctColor }}>{pct}%</span>
          </span>
        )}
        {incident.target?.url && (
          <button type="button" className="incident-card__open" onClick={() => onOpen(incident.target)}>Open</button>
        )}
      </div>
    </article>
  );
}
