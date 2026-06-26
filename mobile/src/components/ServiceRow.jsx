import React from 'react';
import { getServiceIcon } from '@shared/hooks/useData.js';
import StatusDot from './StatusDot.jsx';

/**
 * One service row: base-aware icon (NEVER a relative /api path), name, node tag,
 * status dot, ping. The whole row is a button → onTap(service). Read-only.
 */
export default function ServiceRow({ service, onTap }) {
  const icon = getServiceIcon(service.icon) || getServiceIcon(service.display_name);
  return (
    <button
      type="button"
      className="svc-row"
      onClick={() => onTap && onTap(service)}
      aria-label={`${service.display_name} on ${service.nodeName}`}
    >
      <StatusDot status={service.status} />
      {icon && <img role="img" className="svc-row__icon" src={icon} alt={service.display_name} onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
      <span className="svc-row__name">{service.display_name}</span>
      <span className="svc-row__node">{service.nodeName}</span>
      {service.ping != null && service.ping > 0 && <span className="svc-row__ping">{service.ping}ms</span>}
    </button>
  );
}
