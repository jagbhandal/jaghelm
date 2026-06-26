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
});

test('DEFAULT_PREFS is all-on', () => {
  assert.deepEqual(DEFAULT_PREFS, {
    categories: { service: true, host: true, ups: true, cron: true },
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
  return {
    removed,
    getAllTokens: () => tokens.map((t) => ({ token: t })),
    getPrefs: (t) => prefsByToken[t] ?? DEFAULT_PREFS,
    removeToken: (t) => {
      removed.push(t);
      return true;
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

test('dispatchEvents with no events returns all-zero counts and never touches fcm', async () => {
  const store = fakeStore({ tokens: ['a'], prefsByToken: {} });
  const fcm = fakeFcm({});
  const res = await dispatchEvents([], { store, fcm, logger: silentLog });
  assert.equal(fcm.calls.length, 0);
  assert.deepEqual(res, { sent: 0, suppressed: 0, pruned: 0 });
});
