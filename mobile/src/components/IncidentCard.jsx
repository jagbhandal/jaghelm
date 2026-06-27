import React from 'react';
import UptimeRing from './UptimeRing.jsx';

/**
 * Compact incident card: title, node tag, cause (ALWAYS shown — Bug #8),
 * UptimeRing gauge (replaces UptimeLine — Bug #1 fix), and a secondary ghost
 * Open button (NOT the loud indigo fill — Bug #9).
 *
 * Primary affordance: the card/row itself taps to detail (via the parent nav).
 * Secondary affordance: the ghost Open button opens the service URL externally.
 *
 * Alarm-tinted (red border). onOpen(target) fires on Open button click only.
 */
export default function IncidentCard({ incident, onOpen }) {
  return (
    <article className="incident-card">
      <div className="incident-card__head">
        <span className="incident-card__title">{incident.title}</span>
        <span className="incident-card__node">{incident.node}</span>
      </div>
      {/* Cause is ALWAYS shown (Bug #8 — active cards must be as informative as history) */}
      <p className="incident-card__cause">{incident.cause}</p>
      <div className="incident-card__foot">
        <UptimeRing uptime24={incident.uptime24} />
        {/* Bug #9: ghost secondary button — NOT the loud .open-btn indigo fill */}
        {incident.target?.url && (
          <button
            type="button"
            className="incident-card__open"
            onClick={() => onOpen(incident.target)}
          >
            Open
          </button>
        )}
      </div>
    </article>
  );
}
