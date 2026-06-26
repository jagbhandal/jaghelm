import React from 'react';

/** The Overview health hero: 4 subsystem cells. Degraded = red dot + alarm tint. */
export default function SubsystemStrip({ cells }) {
  return (
    <div className="subsys-strip" role="list" aria-label="Subsystem health">
      {cells.map((c) => (
        <div key={c.key} role="listitem" className={`subsys-cell${c.degraded ? ' subsys-cell--degraded' : ''}`}>
          <span className="subsys-cell__dot" style={{ background: c.degraded ? 'var(--red)' : 'var(--green)', boxShadow: `0 0 8px ${c.degraded ? 'var(--red)' : 'var(--green)'}` }} aria-hidden="true" />
          <span className="subsys-cell__label">{c.label}</span>
          <span className="subsys-cell__detail">{c.detail}</span>
        </div>
      ))}
    </div>
  );
}
