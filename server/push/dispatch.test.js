import { test } from 'node:test';
import assert from 'node:assert/strict';

import { categoryOf, shouldDeliver } from './dispatch.js';
// DEFAULT_PREFS has a single owner (tokenStore.js); import it from there.
import { DEFAULT_PREFS } from './prefs.js';

test('categoryOf maps every event type to its category', () => {
  assert.equal(categoryOf('service_down'), 'service');
  assert.equal(categoryOf('service_recovered'), 'service');
  assert.equal(categoryOf('host_unreachable'), 'host');
  assert.equal(categoryOf('host_threshold'), 'host');
  assert.equal(categoryOf('host_threshold_cleared'), 'host');
  assert.equal(categoryOf('host_recovered'), 'host');
  assert.equal(categoryOf('ups_on_battery'), 'ups');
  assert.equal(categoryOf('ups_restored'), 'ups');
  assert.equal(categoryOf('cron_failed'), 'cron');
  assert.equal(categoryOf('cron_recovered'), 'cron');
  assert.equal(categoryOf('cron_overdue'), 'cron');
});

test('categoryOf: a monitoring source down pages in the category of what it watches (#292)', () => {
  assert.equal(categoryOf('source_down', 'prometheus'), 'host');
  assert.equal(categoryOf('source_recovered', 'prometheus'), 'host');
  assert.equal(categoryOf('source_down', 'kuma'), 'service');
  assert.equal(categoryOf('source_down', 'nut'), 'ups');
  // The installed app's 5 keys: no category of its own.
  assert.equal(categoryOf('source_down', 'something-new'), 'host');
});

test('shouldDeliver: a source event honours its category toggle and the recoveries toggle', () => {
  const noServices = { ...DEFAULT_PREFS, categories: { ...DEFAULT_PREFS.categories, service: false } };
  assert.equal(shouldDeliver({ type: 'source_down', id: 'kuma' }, noServices), false);
  assert.equal(shouldDeliver({ type: 'source_down', id: 'prometheus' }, noServices), true);
  const noRecoveries = { ...DEFAULT_PREFS, notifyRecoveries: false };
  assert.equal(shouldDeliver({ type: 'source_recovered', id: 'prometheus' }, noRecoveries), false);
  assert.equal(shouldDeliver({ type: 'source_down', id: 'prometheus' }, noRecoveries), true);
});

test('the status check\'s push (#440) is in no category: no category switch turns it off; push off and the recoveries switch still do', () => {
  assert.equal(categoryOf('source_down', 'status'), null);
  assert.equal(categoryOf('source_recovered', 'status'), null);
  const allOff = {
    ...DEFAULT_PREFS,
    categories: { service: false, host: false, ups: false, cron: false, watchtower: false },
  };
  assert.equal(shouldDeliver({ type: 'source_down', id: 'status' }, allOff), true);
  assert.equal(shouldDeliver({ type: 'source_recovered', id: 'status' }, allOff), true);
  assert.equal(shouldDeliver({ type: 'source_down', id: 'prometheus' }, allOff), false, 'only the status check');
  assert.equal(shouldDeliver({ type: 'source_down', id: 'status' }, { ...DEFAULT_PREFS, enabled: false }), false);
  const noRecoveries = { ...DEFAULT_PREFS, notifyRecoveries: false };
  assert.equal(shouldDeliver({ type: 'source_recovered', id: 'status' }, noRecoveries), false);
  assert.equal(shouldDeliver({ type: 'source_down', id: 'status' }, noRecoveries), true);
});

test("the config's push (#505) is in no category: a broken services.yaml is everything's problem; push off and the recoveries switch still turn it off", () => {
  assert.equal(categoryOf('source_down', 'config'), null);
  assert.equal(categoryOf('source_recovered', 'config'), null);
  const allOff = {
    ...DEFAULT_PREFS,
    categories: { service: false, host: false, ups: false, cron: false, watchtower: false },
  };
  assert.equal(shouldDeliver({ type: 'source_down', id: 'config' }, allOff), true);
  assert.equal(shouldDeliver({ type: 'source_down', id: 'config' }, { ...DEFAULT_PREFS, enabled: false }), false);
  const noRecoveries = { ...DEFAULT_PREFS, notifyRecoveries: false };
  assert.equal(shouldDeliver({ type: 'source_recovered', id: 'config' }, noRecoveries), false);
});

test('DEFAULT_PREFS is all-on', () => {
  assert.deepEqual(DEFAULT_PREFS, {
    categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
    notifyRecoveries: true,
    enabled: true,
  });
});

test('shouldDeliver passes a normal critical event under default prefs', () => {
  const ev = { type: 'service_down', severity: 'critical' };
  assert.equal(shouldDeliver(ev, DEFAULT_PREFS), true);
});

test('shouldDeliver: enabled=false suppresses ALL events', () => {
  const prefs = { ...DEFAULT_PREFS, enabled: false };
  assert.equal(shouldDeliver({ type: 'service_down' }, prefs), false);
  assert.equal(shouldDeliver({ type: 'host_recovered' }, prefs), false);
  assert.equal(shouldDeliver({ type: 'cron_failed' }, prefs), false);
});

test('shouldDeliver: a single category off suppresses ONLY that category', () => {
  const prefs = {
    categories: { service: false, host: true, ups: true, cron: true },
    notifyRecoveries: true,
    enabled: true,
  };
  assert.equal(shouldDeliver({ type: 'service_down' }, prefs), false);
  assert.equal(shouldDeliver({ type: 'service_recovered' }, prefs), false);
  // other categories untouched
  assert.equal(shouldDeliver({ type: 'host_unreachable' }, prefs), true);
  assert.equal(shouldDeliver({ type: 'ups_on_battery' }, prefs), true);
  assert.equal(shouldDeliver({ type: 'cron_failed' }, prefs), true);
});

test('shouldDeliver: notifyRecoveries=false suppresses recovery events only', () => {
  const prefs = { ...DEFAULT_PREFS, notifyRecoveries: false };
  // recoveries suppressed
  assert.equal(shouldDeliver({ type: 'service_recovered' }, prefs), false);
  assert.equal(shouldDeliver({ type: 'host_recovered' }, prefs), false);
  assert.equal(shouldDeliver({ type: 'host_threshold_cleared' }, prefs), false);
  assert.equal(shouldDeliver({ type: 'ups_restored' }, prefs), false);
  assert.equal(shouldDeliver({ type: 'cron_recovered' }, prefs), false);
  // incidents still delivered
  assert.equal(shouldDeliver({ type: 'service_down' }, prefs), true);
  assert.equal(shouldDeliver({ type: 'host_threshold' }, prefs), true);
  assert.equal(shouldDeliver({ type: 'cron_failed' }, prefs), true);
});

test('arcane push types map to the watchtower category', () => {
  for (const t of ['arcane_update','arcane_heldback','arcane_cleared','arcane_agent_offline','arcane_agent_recovered','arcane_release'])
    assert.equal(categoryOf(t), 'watchtower');
  assert.equal(categoryOf('cron_failed'), 'cron');
  assert.equal(categoryOf('watchtower_update'), 'watchtower');
});

test('watchtower pref off suppresses arcane events', () => {
  const prefs = { enabled: true, notifyRecoveries: true, categories: { service: true, host: true, ups: true, cron: true, watchtower: false } };
  assert.equal(shouldDeliver({ type: 'arcane_update' }, prefs), false);
});

test('the Arcane vulnerability digest maps to the watchtower (Updates) category', () => {
  assert.equal(categoryOf('arcane_vulns'), 'watchtower');
  const prefs = { enabled: true, notifyRecoveries: false, categories: { watchtower: false } };
  assert.equal(shouldDeliver({ type: 'arcane_vulns' }, prefs), false);
  // Not a recovery: delivered with recoveries off.
  assert.equal(shouldDeliver({ type: 'arcane_vulns' }, { ...prefs, categories: {} }), true);
});
