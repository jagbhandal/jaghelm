import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffSnapshots, RECOVERY_TYPES, SEVERITY } from './differ.js';

const EMPTY = { services: {}, hosts: {}, ups: { state: 'unknown' }, cron: {} };
const THRESHOLDS = { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 };

test('exports SEVERITY map covering all event types', () => {
  assert.equal(SEVERITY.service_down, 'critical');
  assert.equal(SEVERITY.service_recovered, 'info');
  assert.equal(SEVERITY.host_unreachable, 'critical');
  assert.equal(SEVERITY.host_recovered, 'info');
  assert.equal(SEVERITY.host_threshold, 'warning');
  assert.equal(SEVERITY.host_threshold_cleared, 'info');
  assert.equal(SEVERITY.ups_on_battery, 'critical');
  assert.equal(SEVERITY.ups_restored, 'info');
  assert.equal(SEVERITY.cron_failed, 'warning');
  assert.equal(SEVERITY.cron_recovered, 'info');
});

test('RECOVERY_TYPES is exactly the info-severity types', () => {
  assert.ok(RECOVERY_TYPES instanceof Set);
  const expected = [
    'service_recovered',
    'host_recovered',
    'host_threshold_cleared',
    'ups_restored',
    'cron_recovered',
  ].sort();
  assert.deepEqual([...RECOVERY_TYPES].sort(), expected);
  for (const [type, sev] of Object.entries(SEVERITY)) {
    assert.equal(RECOVERY_TYPES.has(type), sev === 'info');
  }
});

test('baseline: prev=null returns [] regardless of next', () => {
  assert.deepEqual(diffSnapshots(null, EMPTY, THRESHOLDS), []);
  const populated = {
    services: { 'n1:web': 'down' },
    hosts: { n1: { reachable: false, cpu: 0.99, mem: 0.99, disk: 0.99 } },
    ups: { state: 'on_battery' },
    cron: { 'n1:backup': 'failure' },
  };
  assert.deepEqual(diffSnapshots(null, populated, THRESHOLDS), []);
});

test('no change: identical prev/next returns []', () => {
  const snap = {
    services: { 'n1:web': 'up' },
    hosts: { n1: { reachable: true, cpu: 0.1, mem: 0.1, disk: 0.1 } },
    ups: { state: 'online' },
    cron: { 'n1:backup': 'success' },
  };
  assert.deepEqual(diffSnapshots(snap, snap, THRESHOLDS), []);
});

function svc(map) {
  return { services: map, hosts: {}, ups: { state: 'unknown' }, cron: {} };
}

test('service up->down emits service_down(critical)', () => {
  const prev = svc({ 'n1:web': 'up' });
  const next = svc({ 'n1:web': 'down' });
  const events = diffSnapshots(prev, next, THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'service_down',
    id: 'n1:web',
    node: 'n1',
    title: 'Service down',
    body: 'web on n1 is down',
    severity: 'critical',
    prev: 'up',
    next: 'down',
  });
});

test('service unknown->down emits service_down', () => {
  const events = diffSnapshots(svc({ 'n1:web': 'unknown' }), svc({ 'n1:web': 'down' }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'service_down');
  assert.equal(events[0].prev, 'unknown');
});

test('service down->up emits service_recovered(info)', () => {
  const events = diffSnapshots(svc({ 'n1:web': 'down' }), svc({ 'n1:web': 'up' }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'service_recovered',
    id: 'n1:web',
    node: 'n1',
    title: 'Service recovered',
    body: 'web on n1 is back up',
    severity: 'info',
    prev: 'down',
    next: 'up',
  });
});

test('service down->unknown emits nothing (unknown never emits)', () => {
  assert.deepEqual(diffSnapshots(svc({ 'n1:web': 'down' }), svc({ 'n1:web': 'unknown' }), THRESHOLDS), []);
});

test('service up->up and down->down emit nothing', () => {
  assert.deepEqual(diffSnapshots(svc({ 'n1:web': 'up' }), svc({ 'n1:web': 'up' }), THRESHOLDS), []);
  assert.deepEqual(diffSnapshots(svc({ 'n1:web': 'down' }), svc({ 'n1:web': 'down' }), THRESHOLDS), []);
});

test('service new key in next (no prev entry) treated as prev=unknown', () => {
  // absent in prev => undefined => treated as "unknown"; unknown->down emits
  const events = diffSnapshots(svc({}), svc({ 'n1:web': 'down' }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'service_down');
  assert.equal(events[0].prev, 'unknown');
});

function host(map) {
  return { services: {}, hosts: map, ups: { state: 'unknown' }, cron: {} };
}
const OK = { reachable: true, cpu: 0.1, mem: 0.1, disk: 0.1 };
const DOWN = { reachable: false, cpu: 0, mem: 0, disk: 0 };

test('host reachable true->false emits host_unreachable(critical)', () => {
  const events = diffSnapshots(host({ n1: OK }), host({ n1: DOWN }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'host_unreachable',
    id: 'n1',
    node: 'n1',
    title: 'Host unreachable',
    body: 'n1 is unreachable',
    severity: 'critical',
    prev: true,
    next: false,
  });
});

test('host reachable false->true emits host_recovered(info)', () => {
  const events = diffSnapshots(host({ n1: DOWN }), host({ n1: OK }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'host_recovered',
    id: 'n1',
    node: 'n1',
    title: 'Host recovered',
    body: 'n1 is reachable again',
    severity: 'info',
    prev: false,
    next: true,
  });
});

test('host reachable unchanged emits nothing', () => {
  assert.deepEqual(diffSnapshots(host({ n1: OK }), host({ n1: OK }), THRESHOLDS), []);
  assert.deepEqual(diffSnapshots(host({ n1: DOWN }), host({ n1: DOWN }), THRESHOLDS), []);
});

test('host absent in prev defaults to reachable:false (no false unreachable)', () => {
  // prev missing host => reachable:false; next OK => false->true => host_recovered
  const events = diffSnapshots(host({}), host({ n1: OK }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'host_recovered');
});
