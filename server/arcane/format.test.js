import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUpdatePush,
  buildHeldBackPush,
  buildClearedPush,
  buildAgentOfflinePush,
  buildAgentRecoveredPush,
  buildReleasePush,
} from './format.js';

test('buildUpdatePush: updated and failed', () => {
  assert.deepEqual(buildUpdatePush({ env: 'vm-103', updated: ['a', 'b'], failed: ['c'] }), {
    type: 'arcane_update',
    id: 'arcane:vm-103:update',
    node: 'vm-103',
    title: 'Updates · vm-103',
    body: '2 updated: a, b · 1 failed: c',
    severity: 'warning',
  });
});

test('buildUpdatePush: updated only is info', () => {
  const e = buildUpdatePush({ env: 'pi-1', updated: ['a'], failed: [] });
  assert.equal(e.body, '1 updated: a');
  assert.equal(e.severity, 'info');
});

test('buildUpdatePush: failed only', () => {
  const e = buildUpdatePush({ env: 'pi-1', updated: [], failed: ['x'] });
  assert.equal(e.body, '1 failed: x');
  assert.equal(e.severity, 'warning');
});

test('buildHeldBackPush: singular and plural', () => {
  const one = buildHeldBackPush({ env: 'vm-101', heldBack: ['a'] });
  assert.deepEqual(one, {
    type: 'arcane_heldback',
    id: 'arcane:vm-101:heldback',
    node: 'vm-101',
    title: 'Updates · vm-101',
    body: '1 update held back: a',
    severity: 'info',
  });
  assert.equal(buildHeldBackPush({ env: 'vm-101', heldBack: ['a', 'b'] }).body, '2 updates held back: a, b');
});

test('buildClearedPush', () => {
  assert.deepEqual(buildClearedPush({ env: 'pi-2', cleared: ['a', 'b'] }), {
    type: 'arcane_cleared',
    id: 'arcane:pi-2:cleared',
    node: 'pi-2',
    title: 'Updates · pi-2',
    body: '2 caught up: a, b',
    severity: 'info',
  });
});

test('agent offline / recovered', () => {
  assert.deepEqual(buildAgentOfflinePush({ env: 'pi-1' }), {
    type: 'arcane_agent_offline',
    id: 'arcane:pi-1:agent',
    node: 'pi-1',
    title: 'Arcane · pi-1',
    body: 'Agent disconnected; Arcane cannot manage pi-1',
    severity: 'warning',
  });
  assert.deepEqual(buildAgentRecoveredPush({ env: 'pi-1' }), {
    type: 'arcane_agent_recovered',
    id: 'arcane:pi-1:agent',
    node: 'pi-1',
    title: 'Arcane · pi-1',
    body: 'Agent reconnected',
    severity: 'info',
  });
});

test('buildReleasePush', () => {
  assert.deepEqual(buildReleasePush({ current: 'v2.16.1', newest: 'v2.17.0' }), {
    type: 'arcane_release',
    id: 'arcane:release',
    node: 'arcane',
    title: 'Arcane v2.17.0 available',
    body: 'Running v2.16.1. Upgrade by PR: bump the pinned tag.',
    severity: 'info',
  });
});
