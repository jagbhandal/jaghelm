import React from 'react';
import { getServiceIcon } from '@shared/hooks/useData.js';
import { lastSeenLabel } from '@shared/util/relativeTime.js';
import StatusDot from './StatusDot.jsx';

/**
 * One service row: base-aware icon (NEVER a relative /api path), name (+ "last
 * seen X ago" subtitle for a vanished-container breadcrumb), an "unmonitored"
 * tag when no Kuma monitor matched, node tag, status dot, ping. The whole row is
 * a button → onTap(service). Read-only.
 */
export default function ServiceRow({ service, onTap }) {
  const icon = getServiceIcon(service.icon) || getServiceIcon(service.display_name);
  const isBreadcrumb = service.source === 'presence';
  const isUnmonitored = service.monitored === false && !isBreadcrumb;
  return (
    <button
      type="button"
      className="svc-row"
      onClick={() => onTap && onTap(service)}
      aria-label={`${service.display_name} on ${service.nodeName}`}
    >
      <StatusDot status={service.status} source={service.source} />
      {icon && <img role="img" className="svc-row__icon" src={icon} alt={service.display_name} onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
      <div className="svc-row__name-col">
        <span className="svc-row__name">{service.display_name}</span>
        {isBreadcrumb && <span className="svc-row__subtitle">{lastSeenLabel(service.lastSeenAt)}</span>}
      </div>
      {isUnmonitored && (
        <span className="svc-row__unmonitored" title="No Uptime Kuma monitor — add one to track this service's true status.">
          unmonitored
        </span>
      )}
      <span className="svc-row__node">{service.nodeName}</span>
      {service.ping != null && service.ping > 0 && <span className="svc-row__ping">{service.ping}ms</span>}
    </button>
  );
}
