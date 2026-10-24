/**
 * The FCM `data` block (the legacy sender, removed in stage B of #659): `type`,
 * `id`, `node` and `severity`, strings, and `id` keeps its namespace per type
 * family: a service's card uid, a job's node:job, a host's node or
 * node:reading, the literal "ups", a source's name. Every event type the
 * differ sends goes through the real buildMessage and the web's own routing
 * code here (src/phone/nav/entityRoute.js).
 *
 * #309 adds one key, `entity`: the model's id of what the push is about
 * (androidPayload.js), which opens the same detail a row or the web's
 * `?entity=` URL opens.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffSnapshots, SEVERITY } from './differ.js';
import { buildMessage } from './fcm.js';
import { androidData, entityOf } from './androidPayload.js';
import { entityOfRoute, entityRoute } from '../../src/phone/nav/entityRoute.js';
import {
  buildAgentOfflinePush,
  buildAgentRecoveredPush,
  buildHeldBackPush,
  buildUpdatePush,
} from '../arcane/format.js';

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
    assert.deepEqual(
      Object.keys(msg.data),
      ['type', 'id', 'node', 'severity', 'entity'],
      event.type
    );
    for (const v of Object.values(msg.data)) assert.equal(typeof v, 'string', event.type);
    assert.ok(['critical', 'warning', 'info'].includes(msg.data.severity), event.type);
    assert.ok(msg.notification.title && msg.notification.body, `${event.type} has words`);
    assert.equal(msg.android.notification.channelId, 'jaghelm-incidents');
  }
});

test('the id namespaces are unchanged, and each push routes to its entity (#325, #309)', () => {
  const sent = {};
  const routed = {};
  for (const event of EVENTS) {
    const { data } = buildMessage('token', event);
    const name = `${event.type} ${event.id}`;
    sent[name] = [data.id, data.node, data.entity];
    const route = entityRoute(data.entity);
    assert.ok(route, event.type);
    routed[name] = `${route.screen} ${entityOfRoute(route)}`;
  }
  // What a receiver reads: each family's id and the node, unchanged;
  // and the model's entity id beside them.
  assert.deepEqual(sent, {
    'cron_failed vm103:restic': ['vm103:restic', 'vm103', 'jobs/vm103:restic'],
    'cron_overdue nas:b2': ['nas:b2', 'nas', 'jobs/nas:b2'],
    'cron_recovered vm103:sync': ['vm103:sync', 'vm103', 'jobs/vm103:sync'],
    'host_recovered pi2': ['pi2', 'pi2', 'nodes/pi2'],
    'host_threshold pve:cpu': ['pve:cpu', 'pve', 'nodes/pve'],
    'host_threshold_cleared pve:disk': ['pve:disk', 'pve', 'nodes/pve'],
    'host_unreachable pi1': ['pi1', 'pi1', 'nodes/pi1'],
    'service_down vm103:gitea': ['vm103:gitea', 'vm103', 'services/vm103:gitea'],
    'service_recovered vm103:radarr': ['vm103:radarr', 'vm103', 'services/vm103:radarr'],
    'source_down prometheus': ['prometheus', 'prometheus', 'sources/prometheus'],
    'source_recovered kuma': ['kuma', 'kuma', 'sources/kuma'],
    'ups_on_battery ups': ['ups', 'ups', 'power/ups'],
    'ups_restored ups': ['ups', 'ups', 'power/ups'],
  });
  // Where it opens: the entity's own detail screen.
  assert.deepEqual(routed, {
    'cron_failed vm103:restic': 'incident jobs/vm103:restic',
    'cron_overdue nas:b2': 'incident jobs/nas:b2',
    'cron_recovered vm103:sync': 'incident jobs/vm103:sync',
    'host_recovered pi2': 'node nodes/pi2',
    'host_threshold pve:cpu': 'node nodes/pve',
    'host_threshold_cleared pve:disk': 'node nodes/pve',
    'host_unreachable pi1': 'node nodes/pi1',
    'service_down vm103:gitea': 'serviceDetail services/vm103:gitea',
    'service_recovered vm103:radarr': 'serviceDetail services/vm103:radarr',
    'source_down prometheus': 'incident sources/prometheus',
    'source_recovered kuma': 'incident sources/kuma',
    'ups_on_battery ups': 'incident power/ups',
    'ups_restored ups': 'incident power/ups',
  });
});

test("a backup's push names the backup, as the model files it, not the job (#309)", () => {
  const status = {
    entities: [
      { id: 'backups/pve:proxmox-backup', kind: 'backup', name: 'proxmox-backup', state: 'crit' },
      { id: 'jobs/vm103:restic', kind: 'job', name: 'restic', state: 'warn' },
    ],
  };
  const events = diffSnapshots(
    { ...before, cron: { 'pve:proxmox-backup': 'success', 'vm103:restic': 'success' } },
    { ...before, cron: { 'pve:proxmox-backup': 'failure', 'vm103:restic': 'failure' } },
    status
  );
  assert.deepEqual(
    events.map((e) => [e.id, buildMessage('token', e).data.entity]),
    [
      ['pve:proxmox-backup', 'backups/pve:proxmox-backup'],
      ['vm103:restic', 'jobs/vm103:restic'],
    ]
  );
});

test("an Arcane agent's push names its integration; an update, or the status check, names none", () => {
  const offline = buildAgentOfflinePush({ env: 'vm-103' });
  const back = buildAgentRecoveredPush({ env: 'vm-103' });
  assert.equal(buildMessage('t', offline).data.entity, 'integrations/arcane:vm-103');
  assert.equal(buildMessage('t', back).data.entity, 'integrations/arcane:vm-103');
  for (const event of [
    buildUpdatePush({ env: 'vm-103', updated: ['a'], failed: [] }),
    buildHeldBackPush({ env: 'vm-103', heldBack: ['a'] }),
    ...diffSnapshots(
      { ...after, sources: { status: 'ok' } },
      { ...after, sources: { status: 'down' } }
    ),
  ]) {
    const { data } = buildMessage('t', event);
    assert.deepEqual(Object.keys(data), ['type', 'id', 'node', 'severity'], event.type);
    assert.equal(entityOf(event), null, event.type);
  }
});

test('androidData: every value a string, the entity only when there is one', () => {
  assert.deepEqual(
    androidData({ type: 'ups_on_battery', id: 'ups', node: 'ups', severity: 'critical' }),
    {
      type: 'ups_on_battery',
      id: 'ups',
      node: 'ups',
      severity: 'critical',
      entity: 'power/ups',
    }
  );
  assert.deepEqual(androidData({ type: 'weird', id: 1, node: null, severity: undefined }), {
    type: 'weird',
    id: '1',
    node: 'null',
    severity: 'undefined',
  });
});
