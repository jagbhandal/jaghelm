/*
 * The alert history the gallery draws (#314): /api/events' records (the shape
 * of server/push/alertHistory.js), on the Phone board's incident
 * (phoneBoard.js), so the Alerts states read against its Active rows. Plain
 * data: homelab-looking placeholders. The gallery's clock is frozen at
 * 2026-10-20 09:00 UTC; each event is that many minutes before it.
 */
const NOW = Date.UTC(2026, 9, 20, 9, 0, 0);
const MINUTE = 60_000;
const DAY = 24 * 60;

const push = (state, phones = 0, suppressed = 0) => ({ state, phones, suppressed });
const SENT = push('sent', 2);

let next = 0;
const event = (ago, fields) => ({
  id: String((next += 1)),
  at: new Date(NOW - ago * MINUTE).toISOString(),
  reason: null,
  push: SENT,
  ...fields,
});
const service = (ago, uid, name, down, reason, delivery = SENT) =>
  event(ago, {
    type: down ? 'service_down' : 'service_recovered',
    severity: down ? 'critical' : 'info',
    entity: `services/${uid}`,
    title: down ? 'Service down' : 'Service recovered',
    body: `${name} on ${uid.split(':')[0]} · ${reason}`,
    reason,
    node: uid.split(':')[0],
    key: uid,
    push: delivery,
  });

/** Oldest first, as the file keeps them; ALERT_EVENTS is newest first, as /api/events sends them. */
const OLDEST_FIRST = [
  // Three days ago, before push was set up, a service since taken off the board.
  service(3 * DAY + 30, 'vm-103:plex', 'Plex', true, 'Kuma: down', push('off')),
  service(3 * DAY, 'vm-103:plex', 'Plex', false, 'Kuma: up', push('off')),
  // Yesterday: Prometheus stopped answering for four minutes; Arcane updated three apps.
  event(23 * 60 + 4, {
    type: 'source_down',
    severity: 'warning',
    entity: 'sources/prometheus',
    title: 'Monitoring source down',
    body: 'Prometheus · connect ECONNREFUSED',
    reason: 'connect ECONNREFUSED',
    node: 'prometheus',
    key: 'prometheus',
  }),
  event(23 * 60, {
    type: 'source_recovered',
    severity: 'info',
    entity: 'sources/prometheus',
    title: 'Monitoring source recovered',
    body: 'Prometheus is answering again',
    node: 'prometheus',
    key: 'prometheus',
  }),
  event(20 * 60, {
    type: 'arcane_update',
    severity: 'info',
    entity: null,
    title: 'Updates · vm-103',
    body: '3 updated: immich, nextcloud, wikijs',
    node: 'vm-103',
    key: 'arcane:vm-103:update',
    push: push('sent', 1),
  }),
  // Today.
  service(7 * 60 + 9, 'vm-103:nextcloud', 'Nextcloud', true, 'Kuma: down'),
  service(7 * 60, 'vm-103:nextcloud', 'Nextcloud', false, 'Kuma: up', push('suppressed', 0, 2)),
  event(200, {
    type: 'cron_overdue',
    severity: 'warning',
    entity: 'backups/jagnas:b2-sync',
    title: 'Cron job overdue',
    body: 'b2-sync on jagnas · Last success 27 h ago',
    reason: 'Last success 27 h ago',
    node: 'jagnas',
    key: 'jagnas:b2-sync',
    push: push('unsent'),
  }),
  event(200, {
    type: 'host_threshold',
    severity: 'warning',
    entity: 'nodes/jagnas',
    title: 'Host disk high',
    body: 'JagNAS · Disk 92 % (warning above 90 %)',
    reason: 'Disk 92 % (warning above 90 %)',
    node: 'jagnas',
    key: 'jagnas:disk',
  }),
  service(4, 'vm-103:immich', 'Immich', true, 'Kuma: HTTP 502'),
  event(2, {
    type: 'ups_on_battery',
    severity: 'critical',
    entity: 'power/ups',
    title: 'UPS on battery',
    body: 'UPS · On battery (82 % charge)',
    reason: 'On battery (82 % charge)',
    node: 'ups',
    key: 'ups',
    push: push('queued'),
  }),
];

/** The history, newest first, as /api/events sends it. */
export const ALERT_EVENTS = Object.freeze(OLDEST_FIRST.slice().reverse());

/** The gallery's frozen clock. */
export const ALERTS_NOW = NOW;
