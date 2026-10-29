/**
 * The demo's alert history (#314): what GET /api/events answers in DEMO_MODE
 * (demo.js), so the Alerts pages' History has something to show. It is the
 * history file's own shape (`{ lastId, events }`, push/alertHistory.js), which
 * demo.js loads into the live store and pages with the live route's query
 * reader, so the demo filters and pages as a live install does.
 *
 * Past episodes, each opened and closed, at fixed ages before `now`, are in
 * both scenarios: a service down for six minutes, a disk over its warning line
 * for three hours, a power cut, a monitoring source that stopped answering, a
 * job that missed its schedule, a node that dropped off before push was set
 * up, and a service since taken off the board (opening it says "No longer
 * monitored"). The incident scenario adds an event for each of its open
 * issues (a failing service and backup, and a drive that keeps remapping sectors), at the time the board says it began (its `since`), as the history
 * records the cycle that saw it. Each event's words are the push's (the model's
 * name and reason, push/differ.js; a source's reason is its failure in words,
 * failureWords.js, #605), and `push` says what the phones got.
 *
 * Pure apart from the board it reads: built from `now`, so the ages stay the
 * same however long the demo runs. Every name is the demo board's, or as
 * generic (author-strings scan, scripts/author-strings.test.mjs).
 */
import { demoStatus } from './demoFixtures.js';
import { failureSentence } from './failureWords.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const sent = (phones = 2) => ({ state: 'sent', phones, suppressed: 0 });
const SUPPRESSED = Object.freeze({ state: 'suppressed', phones: 0, suppressed: 2 });
const OFF = Object.freeze({ state: 'off', phones: 0, suppressed: 0 });

/** "a · b", as the differ words a push (push/differ.js line). */
const line = (subject, reason) => (reason ? `${subject} · ${reason}` : subject);

// Why the demo's Prometheus stopped answering, as the model says it.
const PROMETHEUS_REFUSED = failureSentence('prometheus', { cause: 'refused' });

const service = (uid, name, down, ago, push) => {
  const node = uid.split(':')[0];
  const reason = down ? 'Kuma: down' : 'Kuma: up';
  return {
    ago,
    type: down ? 'service_down' : 'service_recovered',
    severity: down ? 'critical' : 'info',
    entity: `services/${uid}`,
    title: down ? 'Service down' : 'Service recovered',
    body: line(`${name} on ${node}`, reason),
    reason,
    node,
    key: uid,
    push,
  };
};

/** The episodes both scenarios have had, each opened and closed, by how long ago. */
const PAST = Object.freeze([
  service('apps:gitea', 'Gitea', true, 20 * HOUR, sent()),
  service('apps:gitea', 'Gitea', false, 20 * HOUR - 6 * MINUTE, sent()),
  {
    ago: 2 * DAY + 4 * HOUR,
    type: 'host_threshold',
    severity: 'warning',
    entity: 'nodes/storage',
    title: 'Host disk high',
    body: 'Storage · Disk 91 % (warning above 90 %)',
    reason: 'Disk 91 % (warning above 90 %)',
    node: 'storage',
    key: 'storage:disk',
    push: sent(),
  },
  {
    // Both phones have recoveries switched off in their settings.
    ago: 2 * DAY + HOUR,
    type: 'host_threshold_cleared',
    severity: 'info',
    entity: 'nodes/storage',
    title: 'Host disk normal',
    body: 'Storage · Healthy',
    reason: 'Healthy',
    node: 'storage',
    key: 'storage:disk',
    push: SUPPRESSED,
  },
  {
    ago: 4 * DAY + 7 * HOUR,
    type: 'ups_on_battery',
    severity: 'critical',
    entity: 'power/ups',
    title: 'UPS on battery',
    body: 'Example UPS 1500VA · On battery (88 % charge)',
    reason: 'On battery (88 % charge)',
    node: 'ups',
    key: 'ups',
    push: sent(),
  },
  {
    ago: 4 * DAY + 7 * HOUR - 4 * MINUTE,
    type: 'ups_restored',
    severity: 'info',
    entity: 'power/ups',
    title: 'UPS restored',
    body: 'Example UPS 1500VA · On mains',
    reason: 'On mains',
    node: 'ups',
    key: 'ups',
    push: sent(),
  },
  {
    ago: 6 * DAY + 2 * HOUR,
    type: 'source_down',
    severity: 'warning',
    entity: 'sources/prometheus',
    title: 'Monitoring source down',
    body: line('Prometheus', PROMETHEUS_REFUSED),
    reason: PROMETHEUS_REFUSED,
    node: 'prometheus',
    key: 'prometheus',
    push: sent(),
  },
  {
    ago: 6 * DAY + 2 * HOUR - 3 * MINUTE,
    type: 'source_recovered',
    severity: 'info',
    entity: 'sources/prometheus',
    title: 'Monitoring source recovered',
    body: 'Prometheus is answering again',
    reason: null,
    node: 'prometheus',
    key: 'prometheus',
    push: sent(),
  },
  {
    ago: 9 * DAY + 5 * HOUR,
    type: 'cron_overdue',
    severity: 'warning',
    entity: 'jobs/apps:db-dump',
    title: 'Cron job overdue',
    body: 'db-dump on apps · Overdue: no report on schedule (expected every 6 h)',
    reason: 'Overdue: no report on schedule (expected every 6 h)',
    node: 'apps',
    key: 'apps:db-dump',
    push: sent(),
  },
  {
    ago: 9 * DAY + 3 * HOUR,
    type: 'cron_recovered',
    severity: 'info',
    entity: 'jobs/apps:db-dump',
    title: 'Cron job recovered',
    body: 'db-dump on apps · Last run succeeded',
    reason: 'Last run succeeded',
    node: 'apps',
    key: 'apps:db-dump',
    push: sent(),
  },
  // A service since taken off the board: its entity is gone from the model.
  service('apps:plex', 'Plex', true, 12 * DAY + 6 * HOUR, OFF),
  service('apps:plex', 'Plex', false, 12 * DAY + 5 * HOUR, OFF),
  {
    ago: 13 * DAY + 2 * HOUR,
    type: 'host_unreachable',
    severity: 'critical',
    entity: 'nodes/edge',
    title: 'Host unreachable',
    body: "Network Edge · Unreachable: Prometheus can't scrape it",
    reason: "Unreachable: Prometheus can't scrape it",
    node: 'edge',
    key: 'edge',
    push: OFF,
  },
  {
    ago: 13 * DAY + HOUR,
    type: 'host_recovered',
    severity: 'info',
    entity: 'nodes/edge',
    title: 'Host recovered',
    body: 'Network Edge · Healthy',
    reason: 'Healthy',
    node: 'edge',
    key: 'edge',
    push: OFF,
  },
]);

/**
 * The event that opened each of the incident board's issues, by its entity:
 * what the differ sends when it first sees it (a failed backup pages as
 * critical, #478).
 */
const OPENED = Object.freeze({
  'services/apps:jellyfin': (issue) => ({
    type: 'service_down',
    severity: 'critical',
    title: 'Service down',
    body: line(`${issue.name} on ${issue.node}`, issue.reason),
    key: 'apps:jellyfin',
  }),
  'backups/storage:nightly-backup': (issue) => ({
    type: 'cron_failed',
    severity: 'critical',
    title: 'Cron job failed',
    body: line(`${issue.name} on ${issue.node}`, issue.reason),
    key: 'storage:nightly-backup',
  }),
  // A drive's own event (#727): its subject "sdb on storage" and its reason.
  'nodes/storage': (issue) => {
    const drive = issue.drives.find((d) => d.state !== 'ok');
    return {
      type: 'host_threshold',
      severity: drive.state === 'crit' ? 'critical' : 'warning',
      title: `Drive ${drive.device} ${drive.state === 'crit' ? 'critical' : 'warning'}`,
      body: line(`${drive.device} on ${issue.node}`, drive.reason),
      reason: drive.reason,
      key: `${issue.node}:${drive.key}`,
    };
  },
});

/**
 * The demo's history in `scenario` at `now`, as the history file holds it:
 * `{ lastId, events }`, oldest first, ids from 1.
 *
 * @param {{ scenario?: string, now?: number }} [opts]
 */
export function demoEvents({ scenario = 'incident', now = Date.now() } = {}) {
  const dated = PAST.map(({ ago, ...event }) => ({ at: now - ago, ...event }));
  // Last issue first: on the warm-up clock they all began together, and the
  // stable sort leaves the first-listed (the failing service) the newest.
  for (const issue of [...demoStatus({ scenario, now }).issues].reverse()) {
    const opened = OPENED[issue.id];
    if (!opened) continue;
    dated.push({
      at: issue.since,
      entity: issue.id,
      reason: issue.reason,
      node: issue.node,
      push: sent(),
      ...opened(issue),
    });
  }
  dated.sort((a, b) => a.at - b.at);
  const events = dated.map(({ at, ...event }, i) => ({
    id: String(i + 1),
    at: new Date(at).toISOString(),
    type: event.type,
    severity: event.severity,
    entity: event.entity,
    title: event.title,
    body: event.body,
    reason: event.reason,
    node: event.node,
    key: event.key,
    push: { ...event.push },
  }));
  return { lastId: events.length, events };
}
