import React from 'react';
import SubsystemCell from './SubsystemCell.jsx';

/**
 * The Overview 2×2 subsystem grid (Services / Nodes / UPS / Cron). Thin renderer:
 * `cells` is the `deriveSubsystems(...)` array — each element is the new
 * `{ key, label, severity, word, detail }` shape (replaces the old `degraded`
 * boolean). Strict worst-of severity + NO-SIGNAL-on-unreachable is decided in
 * derive.js; this component just maps each cell to a `SubsystemCell`.
 */
export default function SubsystemStrip({ cells }) {
  return (
    <div className="subsys-strip" role="list" aria-label="Subsystem health">
      {cells.map((c) => (
        <div key={c.key} role="listitem">
          <SubsystemCell cell={c} />
        </div>
      ))}
    </div>
  );
}
