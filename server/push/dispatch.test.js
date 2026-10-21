import { test } from 'node:test';
import assert from 'node:assert/strict';

import { categoryOf, shouldDeliver, dispatchEvents } from './dispatch.js';
// DEFAULT_PREFS has a single owner (tokenStore.js); import it from there.
import { DEFAULT_PREFS } from './tokenStore.js';

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

// ── dispatchEvents tests ────────────────────────────────────────────────────

// Minimal fake store: in-memory token list + prefs map + remove tracking.
function fakeStore({ tokens, prefsByToken }) {
  const removed = [];
  const delivered = [];
  return {
    removed,
    delivered,
    getAllTokens: () => tokens.map((t) => ({ token: t })),
    getPrefs: (t) => prefsByToken[t] ?? DEFAULT_PREFS,
    removeToken: (t) => {
      removed.push(t);
      return true;
    },
    markDelivered: (list) => {
      delivered.push([...list]);
      return list.length;
    },
  };
}

// Fake fcm whose send result is keyed by token (lets us force prune/ok).
function fakeFcm(resultByToken) {
  const calls = [];
  return {
    calls,
    sendToToken: async (token, event) => {
      calls.push({ token, type: event.type });
      return resultByToken[token] ?? { ok: true, prune: false };
    },
  };
}

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

test('dispatchEvents fans every delivered event across every token', async () => {
  const store = fakeStore({ tokens: ['a', 'b'], prefsByToken: {} });
  const fcm = fakeFcm({});
  const events = [
    { type: 'service_down', id: 'x' },
    { type: 'host_unreachable', id: 'y' },
  ];
  const res = await dispatchEvents(events, { store, fcm, logger: silentLog });
  // 2 events × 2 tokens = 4 sends, none suppressed, none pruned
  assert.equal(fcm.calls.length, 4);
  assert.deepEqual(res, { sent: 4, suppressed: 0, pruned: 0 });
});

test('dispatchEvents suppresses per-token prefs (no send for filtered pairs)', async () => {
  const store = fakeStore({
    tokens: ['a', 'b'],
    prefsByToken: {
      // token a: service category off
      a: { categories: { service: false, host: true, ups: true, cron: true }, notifyRecoveries: true, enabled: true },
      // token b: fully disabled
      b: { ...DEFAULT_PREFS, enabled: false },
    },
  });
  const fcm = fakeFcm({});
  const events = [{ type: 'service_down', id: 'x' }];
  const res = await dispatchEvents(events, { store, fcm, logger: silentLog });
  // a: service off -> suppressed; b: disabled -> suppressed. Zero sends.
  assert.equal(fcm.calls.length, 0);
  assert.deepEqual(res, { sent: 0, suppressed: 2, pruned: 0 });
});

test('dispatchEvents prunes a token whose send returns prune:true, once', async () => {
  const store = fakeStore({ tokens: ['dead', 'live'], prefsByToken: {} });
  const fcm = fakeFcm({
    dead: { ok: false, prune: true, error: 'registration-token-not-registered' },
    live: { ok: true, prune: false },
  });
  // Two events so 'dead' returns prune twice — must still removeToken once.
  const events = [
    { type: 'service_down', id: 'x' },
    { type: 'cron_failed', id: 'y' },
  ];
  const res = await dispatchEvents(events, { store, fcm, logger: silentLog });
  assert.equal(fcm.calls.length, 4); // both tokens, both events
  assert.deepEqual(store.removed, ['dead']); // pruned exactly once
  assert.deepEqual(res, { sent: 4, suppressed: 0, pruned: 1 });
});

test('dispatchEvents marks FCM-accepted tokens delivered in one batch, never pruned or failed ones (#247)', async () => {
  const store = fakeStore({
    tokens: ['live', 'dead', 'flaky', 'muted', 'gone-mid-run'],
    prefsByToken: { muted: { ...DEFAULT_PREFS, enabled: false } },
  });
  let goneSends = 0;
  const fcm = {
    sendToToken: async (token) => {
      if (token === 'dead') return { ok: false, prune: true, error: 'messaging/registration-token-not-registered' };
      if (token === 'flaky') return { ok: false, prune: false, error: 'messaging/internal-error' };
      // Accepted on the first event, rejected as unregistered on the second.
      if (token === 'gone-mid-run') {
        goneSends += 1;
        return goneSends === 1 ? { ok: true, prune: false } : { ok: false, prune: true };
      }
      return { ok: true, prune: false };
    },
  };
  const events = [
    { type: 'service_down', id: 'x' },
    { type: 'cron_failed', id: 'y' },
  ];
  const res = await dispatchEvents(events, { store, fcm, logger: silentLog });
  assert.deepEqual(store.delivered, [['live']], 'one batched call, accepted-and-still-valid tokens only');
  assert.deepEqual(store.removed.sort(), ['dead', 'gone-mid-run'], 'invalid-token errors still prune');
  assert.deepEqual(res, { sent: 8, suppressed: 2, pruned: 2 });
});

test('dispatchEvents with no events returns all-zero counts and never touches fcm', async () => {
  const store = fakeStore({ tokens: ['a'], prefsByToken: {} });
  const fcm = fakeFcm({});
  const res = await dispatchEvents([], { store, fcm, logger: silentLog });
  assert.equal(fcm.calls.length, 0);
  assert.deepEqual(res, { sent: 0, suppressed: 0, pruned: 0 });
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
