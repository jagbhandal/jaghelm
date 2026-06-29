// server/watchtower/format.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeDiscord, buildPushEvent, buildDiscordContent, buildHeldBackPushEvent, buildClearedPushEvent } from './format.js';
import { categoryOf, shouldDeliver } from '../push/dispatch.js';
import { RECOVERY_TYPES } from '../push/differ.js';

const UP = { node: 'vm-101', updated: [{ name: 'radarr', from: 'v1', to: 'v2' }], failed: [] };
const UPFAIL = { node: 'vm-101', updated: [{ name: 'radarr', from: 'v1', to: 'v2' }], failed: [{ name: 'sonarr', error: 'pull error' }] };

test('push event type maps to the watchtower category', () => {
  assert.equal(categoryOf(buildPushEvent(UP).type), 'watchtower');
});

test('push event: info when no failures, warning when failures', () => {
  assert.equal(buildPushEvent(UP).severity, 'info');
  const e = buildPushEvent(UPFAIL);
  assert.equal(e.severity, 'warning');
  assert.equal(e.title, 'Watchtower · vm-101');
  assert.match(e.body, /1 updated: radarr/);
  assert.match(e.body, /1 failed/);
});

test('escapeDiscord defangs mentions and markdown', () => {
  assert.equal(escapeDiscord('@everyone'), '@​everyone');
  assert.match(escapeDiscord('a`b*c'), /a\\`b\\\*c/);
});

test('escapeDiscord neutralizes user/channel mentions and link brackets', () => {
  assert.equal(escapeDiscord('<@279648609777>'), '\\<@279648609777\\>');
  assert.match(escapeDiscord('[x](y)'), /\\\[x\\\]\(y\)/);
});

test('discord content lists updates and failures on separate lines', () => {
  const out = buildDiscordContent(UPFAIL);
  const lines = out.split('\n');
  assert.match(lines[0], /Watchtower · vm-101.*Updated: radarr \(v1→v2\)/);
  assert.match(lines[1], /Failed: sonarr \(pull error\)/);
});

const HELD = [{ name: 'vaultwarden', current: '1a', latest: '2b' }];

test('held-back push event maps to the watchtower category and is info severity', () => {
  const e = buildHeldBackPushEvent({ node: 'vm-101', heldBack: HELD });
  assert.equal(categoryOf(e.type), 'watchtower');
  assert.equal(e.severity, 'info');
  assert.match(e.body, /1 update held back: vaultwarden/);
});

test('held-back push is NOT a recovery (fires regardless of notifyRecoveries)', () => {
  const e = buildHeldBackPushEvent({ node: 'vm-101', heldBack: HELD });
  assert.equal(RECOVERY_TYPES.has(e.type), false);
  const prefs = { enabled: true, categories: { watchtower: true }, notifyRecoveries: false };
  assert.equal(shouldDeliver(e, prefs), true);
});

test('cleared push is a recovery, suppressed when notifyRecoveries is off', () => {
  const e = buildClearedPushEvent({ node: 'vm-101', cleared: HELD });
  assert.equal(categoryOf(e.type), 'watchtower');
  assert.equal(RECOVERY_TYPES.has(e.type), true);
  assert.match(e.body, /1 caught up: vaultwarden/);
  const on = { enabled: true, categories: { watchtower: true }, notifyRecoveries: true };
  const off = { enabled: true, categories: { watchtower: true }, notifyRecoveries: false };
  assert.equal(shouldDeliver(e, on), true);
  assert.equal(shouldDeliver(e, off), false);
});

test('discord content renders held-back (standing) and caught-up sections', () => {
  const out = buildDiscordContent({
    node: 'vm-101', updated: [], failed: [],
    heldBack: [{ name: 'vaultwarden', current: '1a', latest: '2b' }],
    cleared: [{ name: 'adguard', current: 'aa', latest: 'bb' }],
  });
  const lines = out.split('\n');
  assert.match(lines[0], /⏸️.*Watchtower · vm-101.*Held back \(1\): vaultwarden \(1a→2b\)/);
  assert.match(lines[1], /✅.*Watchtower · vm-101.*Caught up: adguard/);
});

test('discord content is empty string when nothing to report', () => {
  assert.equal(buildDiscordContent({ node: 'vm-101', updated: [], failed: [] }), '');
});
