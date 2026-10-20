/**
 * Push built on the status model (#292) keeps what installed Android apps read
 * from a push. The FCM `data` block is the app's only input: `type`, `id`,
 * `node` and `severity`, strings (mobile/src/push/routeFromData.js), and `id`
 * keeps its namespace per type family (mobile/src/push/fcmIdToIncidentId.js:
 * a service's card uid, a job's node:job, a host's node or node:reading, the
 * literal "ups"). Only the notification's title and body, which Android shows
 * as they are, changed wording. Every event type the differ sends goes
 * through the real buildMessage and the app's own routing code here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffSnapshots, SEVERITY } from './differ.js';
import { buildMessage } from './fcm.js';
import { routeFromData } from '../../mobile/src/push/routeFromData.js';

const before = {
  services: { 'vm103:gitea': 'up', 'vm103:radarr': 'down' },
  hosts: {
    pve: { reachable: true, levels: { cpu: 'ok', disk: 'warn' } },
    pi1: { reachable: true, levels: {} },
    pi2: { reachable: false, levels: {} },
  },
  ups: { state: 'online' },
  cron: { 'vm103:restic': 'success', 'vm103:sync': 'failure', 'nas:b2': 'success' },
  sources: { prometheus: 'failing', kuma: 'down' },
};
const after = {
  services: { 'vm103:gitea': 'down', 'vm103:radarr': 'up' },
  hosts: {
    pve: { reachable: true, levels: { cpu: 'warn', disk: 'ok' } },
    pi1: { reachable: false, levels: {} },
    pi2: { reachable: true, levels: {} },
  },
  ups: { state: 'on_battery' },
  cron: { 'vm103:restic': 'failure', 'vm103:sync': 'success', 'nas:b2': 'overdue' },
  sources: { prometheus: 'down', kuma: 'ok' },
};
const EVENTS = [
  ...diffSnapshots(before, after),
  ...diffSnapshots(
    { ...after, ups: { state: 'on_battery' } },
    { ...after, ups: { state: 'online' } }
  ),
];

test('the events cover every type the differ sends', () => {
  assert.deepEqual([...new Set(EVENTS.map((e) => e.type))].sort(), Object.keys(SEVERITY).sort());
});

test('every push keeps the data keys the app reads, as strings, with the same meaning', () => {
  for (const event of EVENTS) {
    const msg = buildMessage('token', event);
    assert.deepEqual(Object.keys(msg.data), ['type', 'id', 'node', 'severity'], event.type);
    for (const v of Object.values(msg.data)) assert.equal(typeof v, 'string', event.type);
    assert.ok(['critical', 'warning', 'info'].includes(msg.data.severity), event.type);
    assert.ok(msg.notification.title && msg.notification.body, `${event.type} has words`);
    assert.equal(msg.android.notification.channelId, 'jaghelm-incidents');
  }
});

test('the app routes every push as it did: the id namespaces are unchanged', () => {
  const routed = {};
  for (const event of EVENTS) {
    const pushed = [];
    routeFromData(buildMessage('token', event).data, {
      push: (screen, params) => pushed.push([screen, params]),
    });
    assert.equal(pushed.length, 1, event.type);
    routed[`${event.type} ${event.id}`] = pushed[0][1].id;
  }
  assert.deepEqual(routed, {
    'cron_failed vm103:restic': 'cron:vm103:restic',
    'cron_overdue nas:b2': 'cron:nas:b2',
    'cron_recovered vm103:sync': 'cron:vm103:sync',
    'host_recovered pi2': null,
    'host_threshold pve:cpu': null,
    'host_threshold_cleared pve:disk': null,
    'host_unreachable pi1': null,
    'service_down vm103:gitea': 'service:vm103:gitea',
    'service_recovered vm103:radarr': 'service:vm103:radarr',
    // New (#292): the app shows it from the push itself, as it does a host's.
    'source_down prometheus': null,
    'source_recovered kuma': null,
    'ups_on_battery ups': 'ups:apcups',
    'ups_restored ups': 'ups:apcups',
  });
});
