import React from 'react';
import { lastSeenLabel } from '../../util/relativeTime.js';
import { EntityRow } from '@ui/entity-row';
import { StripWithNote, UptimeBar } from '@ui/uptime-bar';

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
 * The row (#303) is the shared EntityRow, the Phone board's row: the
 * lamp, the name and its node over one line, and nothing judged here. The
 * line is the model's reason when the service isn't up, else "last seen 3m
 * ago" for a breadcrumb, or "Unmonitored", and the latency after it ("138
 * ms", a dash without one), and a monitored service's heartbeat strip
 * (#312: UptimeBar; EntityRow shows its newest 12 at a phone's width). The
 * row opens the service; healthy rows are muted, so a failing one stands out.
 */
export default function ServiceRow({ service, onTap }) {
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
      stack={service.stack}
      meta={latency}
      trailing={
        service.beats ? (
          <StripWithNote history={service.beatsHistory} beside>
            <UptimeBar
              beats={service.beats}
              count={30}
              stale={service.stale}
              history={service.beatsHistory}
            />
          </StripWithNote>
        ) : undefined
      }
      muted
      onOpen={onTap ? () => onTap(service) : undefined}
    />
  );
}
