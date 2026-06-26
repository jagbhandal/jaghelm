import React from 'react';
import { uptimePct, uptimeColor } from '../data/derive.js';

/**
 * Renders the "24H uptime NN.N%" row consistently across IncidentCard,
 * ServiceDetail, and IncidentDetail. Returns null when uptime24 is null.
 */
export default function UptimeLine({ uptime24 }) {
  const pct = uptimePct(uptime24);
  if (pct === null) return null;
  return (
    <p className="detail-uptime">
      <span>24H uptime</span>{' '}
      <strong style={{ color: uptimeColor(uptime24) }}>{pct}%</strong>
    </p>
  );
}
