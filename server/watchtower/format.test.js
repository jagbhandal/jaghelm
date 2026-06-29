// server/watchtower/format.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeDiscord, buildPushEvent, buildDiscordContent } from './format.js';
import { categoryOf } from '../push/dispatch.js';

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
