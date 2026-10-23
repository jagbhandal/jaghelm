import React from 'react';
import { getServiceIcon } from '../../hooks/useData.js';
import { lastSeenLabel } from '../../util/relativeTime.js';
import { EntityRow } from '@ui/entity-row';
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
 *
 * The web look (#303) is the shared EntityRow, the Phone board's row: the
 * lamp, the name and its node over one line, and nothing judged here. The
 * line is the model's reason when the service isn't up, else "last seen 3m
 * ago" for a breadcrumb, or "Unmonitored", and the latency after it ("138
 * ms", a dash without one). The row opens the service; healthy rows are
 * muted, so a failing one stands out.
 */
export default function ServiceRow(props) {
  if (__ANDROID_LOOK__) return <AndroidServiceRow {...props} />;
  return <WebServiceRow {...props} />;
}

function WebServiceRow({ service, onTap }) {
  const isBreadcrumb = service.source === 'presence';
  const isUnmonitored = service.monitored === false && !isBreadcrumb;
  const up = service.modelState === 'ok';
  const detail =
    !up && service.reason
      ? service.reason
      : isBreadcrumb
        ? lastSeenLabel(service.lastSeenAt)
        : isUnmonitored
          ? 'Unmonitored'
          : null;
  const latency = up && service.ping != null && service.ping > 0 ? `${service.ping} ms` : '—';
  return (
    <EntityRow
      state={service.state}
      word={service.word}
      name={service.display_name}
      where={service.nodeName}
      detail={detail}
      meta={latency}
      muted
      onOpen={onTap ? () => onTap(service) : undefined}
    />
  );
}

function AndroidServiceRow({ service, onTap }) {
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
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
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
