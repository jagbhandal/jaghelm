import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUpdatePush,
  buildHeldBackPush,
  buildClearedPush,
  buildAgentOfflinePush,
  buildAgentRecoveredPush,
  buildReleasePush,
  buildVulnDigestPush,
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

test('push bodies cap each name at 64 characters and list at most 10 names', () => {
  const many = Array.from({ length: 13 }, (_, i) => `c${i}`);
  assert.equal(
    buildHeldBackPush({ env: 'vm-103', heldBack: many }).body,
    '13 updates held back: c0, c1, c2, c3, c4, c5, c6, c7, c8, c9 +3 more'
  );
  assert.equal(
    buildClearedPush({ env: 'vm-103', cleared: many.slice(0, 11) }).body,
    '11 caught up: c0, c1, c2, c3, c4, c5, c6, c7, c8, c9 +1 more'
  );
  const long = 'x'.repeat(300);
  const e = buildUpdatePush({ env: 'vm-103', updated: [long], failed: many });
  assert.equal(
    e.body,
    `1 updated: ${'x'.repeat(63)}… · 13 failed: c0, c1, c2, c3, c4, c5, c6, c7, c8, c9 +3 more`
  );
  // Exactly 10 names and a 64-character name are left as they are.
  const ten = many.slice(0, 10);
  assert.equal(buildClearedPush({ env: 'e', cleared: ten }).body, `10 caught up: ${ten.join(', ')}`);
  assert.equal(buildClearedPush({ env: 'e', cleared: ['y'.repeat(64)] }).body, `1 caught up: ${'y'.repeat(64)}`);
});

const digest = (over = {}) => ({
  newCritical: 0,
  newHigh: 0,
  images: 0,
  top: [],
  kev: null,
  kevNew: 0,
  fixed: 0,
  stale: [],
  failed: [],
  stillStale: [],
  stillFailed: [],
  push: true,
  severity: 'info',
  ...over,
});

test('buildVulnDigestPush: new findings, top images, KEV', () => {
  const d = digest({
    newCritical: 3,
    newHigh: 11,
    images: 9,
    top: [
      { name: 'nextcloud', critical: 2, high: 0 },
      { name: 'immich-server', critical: 1, high: 0 },
    ],
    kev: 1,
    severity: 'warning',
  });
  assert.deepEqual(buildVulnDigestPush({ env: 'vm-103', digest: d }), {
    type: 'arcane_vulns',
    id: 'arcane:vm-103:vulns',
    node: 'vm-103',
    title: 'Vulnerabilities · vm-103',
    body: '3 new critical, 11 new high (fix available) · 9 images · top: nextcloud 2C, immich-server 1C · KEV 1',
    severity: 'warning',
  });
});

test('buildVulnDigestPush: highs only, mixed top entries, fixed and new KEV', () => {
  const d = digest({
    newHigh: 1,
    images: 1,
    top: [{ name: 'redis', critical: 0, high: 1 }],
    kev: 3,
    kevNew: 2,
    fixed: 12,
  });
  assert.equal(
    buildVulnDigestPush({ env: 'vm-103', digest: d }).body,
    '1 new high (fix available) · 1 image · top: redis 1H · KEV 3 (2 new) · 12 fixed'
  );
  const both = digest({ newCritical: 1, newHigh: 2, images: 1, top: [{ name: 'a', critical: 1, high: 2 }] });
  assert.equal(
    buildVulnDigestPush({ env: 'e', digest: both }).body,
    '1 new critical, 2 new high (fix available) · 1 image · top: a 1C 2H'
  );
});

test('buildVulnDigestPush: scan health only', () => {
  const d = digest({ stale: ['redis', 'gitea'], failed: ['nextcloud'], kev: 0, fixed: 1 });
  const e = buildVulnDigestPush({ env: 'vm-103', digest: d });
  assert.equal(
    e.body,
    '1 fixed · 2 images not scanned in 9 days: redis, gitea · 1 scan failed: nextcloud'
  );
  assert.equal(e.severity, 'info');
  assert.equal(
    buildVulnDigestPush({ env: 'e', digest: digest({ stale: ['a'] }) }).body,
    '1 image not scanned in 9 days: a'
  );
  assert.equal(
    buildVulnDigestPush({ env: 'e', digest: digest({ failed: ['a', 'b'] }) }).body,
    '2 scans failed: a, b'
  );
});

test('buildVulnDigestPush caps names and lists like the other pushes', () => {
  const many = Array.from({ length: 12 }, (_, i) => `img${i}`);
  const long = 'n'.repeat(100);
  const d = digest({
    newCritical: 1,
    images: 1,
    top: [{ name: long, critical: 1, high: 0 }],
    stale: many,
  });
  assert.equal(
    buildVulnDigestPush({ env: 'e', digest: d }).body,
    `1 new critical (fix available) · 1 image · top: ${'n'.repeat(63)}… 1C · ` +
      '12 images not scanned in 9 days: img0, img1, img2, img3, img4, img5, img6, img7, img8, img9 +2 more'
  );
});

test('buildVulnDigestPush: scan problems already reported are listed after the new ones', () => {
  const d = digest({
    newHigh: 1,
    images: 1,
    top: [{ name: 'redis', critical: 0, high: 1 }],
    failed: ['gitea'],
    stillStale: ['a', 'b'],
    stillFailed: ['nextcloud'],
  });
  assert.equal(
    buildVulnDigestPush({ env: 'vm-103', digest: d }).body,
    '1 new high (fix available) · 1 image · top: redis 1H · 1 scan failed: gitea · ' +
      'still not scanned: a, b · still failing: nextcloud'
  );
});
