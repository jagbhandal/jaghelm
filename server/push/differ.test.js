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
