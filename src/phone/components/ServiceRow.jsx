import React from 'react';
import { getServiceIcon } from '../../hooks/useData.js';
import { lastSeenLabel } from '../../util/relativeTime.js';
import { StatusLamp } from '@ui/status-lamp';
import { StatusWord } from '@ui/status-word';

/**
 * One service row: StatusLamp + StatusWord + base-aware icon (NEVER a relative
 * /api path) + name (DM Sans, ellipsis) + node tag (mono) + ping (mono;
 * omitted when null). The lamp and word are the status model's for the
 * service (#325; data/board.js serviceRowsOf gives `state` and `word`: "Up",
 * "Down", "Pending", "Missing", "Maintenance", "No signal"). The whole row is
 * a button → onTap(service). Breadcrumbs show "last seen X ago"; unmonitored
 * services show an "unmonitored" tag. Compact ≤ 48px; worst-first ordering
 * is the caller's responsibility.
 */
export default function ServiceRow({ service, onTap }) {
  const icon = getServiceIcon(service.icon) || getServiceIcon(service.display_name);
  const isBreadcrumb = service.source === 'presence';
  const isUnmonitored = service.monitored === false && !isBreadcrumb;
  const { state, word } = service;

  return (
    <button
      type="button"
      className="svc-row"
      onClick={() => onTap && onTap(service)}
      aria-label={`${service.display_name} on ${service.nodeName}`}
    >
      <StatusLamp state={state} label={word} size={16} />
      <StatusWord word={word} state={state} />
      {icon && (
        <img
          role="img"
          className="svc-row__icon"
          src={icon}
          alt={service.display_name}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      <div className="svc-row__name-col">
        <span className="svc-row__name">{service.display_name}</span>
        {isBreadcrumb && (
          <span className="svc-row__subtitle">{lastSeenLabel(service.lastSeenAt)}</span>
        )}
      </div>
      {isUnmonitored && (
        <span
          className="svc-row__unmonitored"
          title="No Uptime Kuma monitor — add one to track this service's true status."
        >
          unmonitored
        </span>
      )}
      <span className="svc-row__node">{service.nodeName}</span>
      {service.ping != null && service.ping > 0 && (
        <span className="svc-row__ping">{service.ping}ms</span>
      )}
    </button>
  );
}
