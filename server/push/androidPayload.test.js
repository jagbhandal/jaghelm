/**
 * Push built on the status model (#292) keeps what installed Android apps read
 * from a push. The FCM `data` block is the app's only input: `type`, `id`,
 * `node` and `severity`, strings (mobile/src/push/routeFromData.js), and `id`
 * keeps its namespace per type family: a service's card uid, a job's
 * node:job, a host's node or node:reading, the literal "ups", a source's
 * name. Only the notification's title and body, which Android shows as they
 * are, changed wording. Every event type the differ sends goes through the
 * real buildMessage and the app's own routing code here: an installed app
 * maps the ids as it always has, and this one (#325) maps them onto the
 * status model's entity ids (mobile/src/push/fcmIdToIncidentId.js).
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

test('the id namespaces are unchanged, and the app routes each push to its entity (#325)', () => {
  const sent = {};
  const routed = {};
  for (const event of EVENTS) {
    const { data } = buildMessage('token', event);
    sent[`${event.type} ${event.id}`] = [data.id, data.node];
    const pushed = [];
    routeFromData(data, { push: (screen, params) => pushed.push([screen, params]) });
    assert.equal(pushed.length, 1, event.type);
    routed[`${event.type} ${event.id}`] = pushed[0][1].id;
  }
  // What an installed app reads: each family's id, and the node.
  assert.deepEqual(sent, {
    'cron_failed vm103:restic': ['vm103:restic', 'vm103'],
    'cron_overdue nas:b2': ['nas:b2', 'nas'],
    'cron_recovered vm103:sync': ['vm103:sync', 'vm103'],
    'host_recovered pi2': ['pi2', 'pi2'],
    'host_threshold pve:cpu': ['pve:cpu', 'pve'],
    'host_threshold_cleared pve:disk': ['pve:disk', 'pve'],
    'host_unreachable pi1': ['pi1', 'pi1'],
    'service_down vm103:gitea': ['vm103:gitea', 'vm103'],
    'service_recovered vm103:radarr': ['vm103:radarr', 'vm103'],
    'source_down prometheus': ['prometheus', 'prometheus'],
    'source_recovered kuma': ['kuma', 'kuma'],
    'ups_on_battery ups': ['ups', 'ups'],
    'ups_restored ups': ['ups', 'ups'],
  });
  // Where this app opens it: the model's entity, whose issue Incident detail finds.
  assert.deepEqual(routed, {
    'cron_failed vm103:restic': 'jobs/vm103:restic',
    'cron_overdue nas:b2': 'jobs/nas:b2',
    'cron_recovered vm103:sync': 'jobs/vm103:sync',
    'host_recovered pi2': 'nodes/pi2',
    'host_threshold pve:cpu': 'nodes/pve',
    'host_threshold_cleared pve:disk': 'nodes/pve',
    'host_unreachable pi1': 'nodes/pi1',
    'service_down vm103:gitea': 'services/vm103:gitea',
    'service_recovered vm103:radarr': 'services/vm103:radarr',
    'source_down prometheus': 'sources/prometheus',
    'source_recovered kuma': 'sources/kuma',
    'ups_on_battery ups': 'power/ups',
    'ups_restored ups': 'power/ups',
  });
});
