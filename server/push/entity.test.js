/**
 * The entity a push is about (#309, entity.js): every event type the differ
 * sends names the model's entity (or none, for an Arcane update or the status
 * check), the Web Push payload carries it as its tag and its tap's URL
 * (webPush.js buildWebPayload), and the web's own routing code opens the
 * entity's detail (src/phone/nav/entityRoute.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffSnapshots, SEVERITY } from './differ.js';
import { alertKey, alertKind } from './dispatch.js';
import { entityOf } from './entity.js';
import { buildWebPayload } from './webPush.js';
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

test('every push builds a Web Push payload of strings, with the entity as its tag and URL', () => {
  for (const event of EVENTS) {
    const payload = buildWebPayload(event);
    // A page also offers Snooze and Ack (#669): `keys` and `actions`.
    const page = alertKind(event) === 'page';
    assert.deepEqual(
      Object.keys(payload),
      ['v', 'title', 'body', 'tag', 'url', 'severity', 'type', ...(page ? ['keys', 'actions'] : [])],
      event.type
    );
    if (page) assert.deepEqual(payload.keys, [alertKey(event)], event.type);
    assert.equal(payload.type, event.type);
    assert.ok(['critical', 'warning', 'info'].includes(payload.severity), event.type);
    assert.ok(payload.title && payload.body, `${event.type} has words`);
    assert.equal(payload.tag, entityOf(event), event.type);
    assert.equal(payload.url, `/?entity=${entityOf(event)}`, event.type);
  }
});

test('each push names its entity and routes to its detail (#325, #309)', () => {
  const sent = {};
  const routed = {};
  for (const event of EVENTS) {
    const entity = entityOf(event);
    const name = `${event.type} ${event.id}`;
    sent[name] = [event.id, event.node, entity];
    const route = entityRoute(entity);
    assert.ok(route, event.type);
    routed[name] = `${route.screen} ${entityOfRoute(route)}`;
  }
  // Each family's id and node, and the model's entity id beside them.
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
    events.map((e) => [e.id, entityOf(e)]),
    [
      ['pve:proxmox-backup', 'backups/pve:proxmox-backup'],
      ['vm103:restic', 'jobs/vm103:restic'],
    ]
  );
});

test("an Arcane agent's push names its integration; an update, or the status check, names none", () => {
  const offline = buildAgentOfflinePush({ env: 'vm-103' });
  const back = buildAgentRecoveredPush({ env: 'vm-103' });
  assert.equal(entityOf(offline), 'integrations/arcane:vm-103');
  assert.equal(entityOf(back), 'integrations/arcane:vm-103');
  for (const event of [
    buildUpdatePush({ env: 'vm-103', updated: ['a'], failed: [] }),
    buildHeldBackPush({ env: 'vm-103', heldBack: ['a'] }),
    ...diffSnapshots(
      { ...after, sources: { status: 'ok' } },
      { ...after, sources: { status: 'down' } }
    ),
  ]) {
    assert.equal(entityOf(event), null, event.type);
    assert.equal(buildWebPayload(event).url, '/', event.type);
  }
});
