/**
 * "Send test push" (#320, #268): a push like any other, recorded in the alert
 * history and sent by the outbox's sender, to one phone or every phone, at
 * most one per phone every 30 seconds; what became of it is followed phone by
 * phone, in words. The sender keeps each phone's last delivery and last
 * failed send in the token store for the device list.
 *
 * Real snapshot, sender and token store, each on a temp file; only the channel is
 * faked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPushSnapshot } from './dispatch.js';
import { createPushSender } from './outbox.js';
import { createTestPush, TEST_PUSH_COOLDOWN_MS } from './testPush.js';
import { DEFAULT_PREFS, deviceIdOf } from './prefs.js';
import { createPhoneStore } from '../testing/phoneStore.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const T0 = 1_782_345_600_000;

const OK = { ok: true, prune: false };
const INTERNAL = {
  ok: false,
  prune: false,
  retry: true,
  allPhones: false,
  error: 'webpush/server-error',
};
const UNREACHABLE = {
  ok: false,
  prune: false,
  retry: true,
  allPhones: true,
  error: 'webpush/network-error',
};
const DEAD = {
  ok: false,
  prune: true,
  retry: false,
  allPhones: false,
  error: 'webpush/gone',
};
const REFUSED = {
  ok: false,
  prune: false,
  retry: false,
  allPhones: false,
  error: 'webpush/rejected',
};

/**
 * The pipeline a test push goes through, with phones `tokens` registered and
 * a sender that answers each send from `answers[token]` (OK when none is given).
 */
function rig(tokens = ['tok-pixel', 'tok-tab'], answers = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jh-testpush-'));
  let clock = T0;
  const now = () => clock;
  const store = createPhoneStore({ now });
  for (const token of tokens) store.registerToken(token, { platform: 'web' });
  const snapshot = createPushSnapshot({
    path: join(dir, 'push-snapshot.json'),
    now,
    logger: silent,
  });
  const channels = {
    enabled: true,
    sent: [],
    isPushEnabled: () => channels.enabled,
    async sendToToken(token, event) {
      channels.sent.push({ token, event });
      const answer = answers[token];
      return typeof answer === 'function' ? answer() : (answer ?? OK);
    },
  };
  let testPush;
  const sender = createPushSender({
    outbox: snapshot,
    store,
    channels,
    logger: silent,
    now,
    sleep: () => new Promise(() => {}), // a wait never ends: each test drives one round
    onResult: (event, token, outcome) => testPush.onResult(event, token, outcome),
  });
  testPush = createTestPush({ snapshot, sender, store, channels, now, logger: silent });
  return {
    store,
    snapshot,
    channels,
    sender,
    testPush,
    tick: (ms) => {
      clock += ms;
    },
    /** Let the sender's round run. */
    settle: () => new Promise((resolve) => setImmediate(resolve)),
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const PIXEL = deviceIdOf('tok-pixel');
const TAB = deviceIdOf('tok-tab');

test('a test push to every phone goes through the outbox, is recorded in the history, and says what each phone did', async () => {
  const r = rig();
  try {
    const out = r.testPush.send(null);
    assert.equal(out.status, 202);
    assert.equal(out.body.device, null);
    assert.equal(out.body.done, false);
    await r.settle();
    // Sent by the sender, one send per phone, with the push's words.
    assert.deepEqual(
      r.channels.sent.map((s) => [s.token, s.event.type, s.event.title]),
      [
        ['tok-pixel', 'push_test', 'JagHelm test push'],
        ['tok-tab', 'push_test', 'JagHelm test push'],
      ]
    );
    // Recorded like any push (GET /api/events), and what push did with it.
    const [record] = r.snapshot.events({}).events;
    assert.equal(record.id, out.body.historyId);
    assert.deepEqual(
      [record.type, record.severity, record.entity, record.push],
      ['push_test', 'info', null, { state: 'sent', phones: 2, suppressed: 0 }]
    );
    const last = r.testPush.last();
    assert.equal(last.done, true);
    assert.equal(last.sentence, 'Delivered to 2 of 2 phones.');
    assert.deepEqual(
      last.results.map((p) => [p.device, p.state]),
      [
        [PIXEL, 'sent'],
        [TAB, 'sent'],
      ]
    );
    assert.match(last.results[0].sentence, /^Delivered: the browser's push service accepted it/);
    // The token store has each phone's delivery.
    assert.equal(r.store.getToken('tok-pixel').lastDeliveredAt, T0);
    assert.equal(r.snapshot.outbox().length, 0);
  } finally {
    r.close();
  }
});

test('a test push to one phone goes to that phone alone, and the others are not counted as switched off', async () => {
  const r = rig();
  try {
    assert.equal(r.testPush.send(TAB).status, 202);
    await r.settle();
    assert.deepEqual(
      r.channels.sent.map((s) => [s.token, s.event.device]),
      [['tok-tab', TAB]]
    );
    const [record] = r.snapshot.events({}).events;
    assert.deepEqual(record.push, { state: 'sent', phones: 1, suppressed: 0 });
    assert.equal(record.key, TAB);
    const last = r.testPush.last();
    assert.deepEqual(
      last.results.map((p) => p.device),
      [TAB]
    );
    assert.equal(last.sentence, last.results[0].sentence);
  } finally {
    r.close();
  }
});

test('one test push per phone every 30 seconds: 429 with the wait; every phone counts for each', async () => {
  const r = rig();
  try {
    assert.equal(r.testPush.send(PIXEL).status, 202);
    r.tick(10_000);
    const again = r.testPush.send(PIXEL);
    assert.deepEqual([again.status, again.retryAfterS], [429, 20]);
    assert.match(again.error, /One test push per phone every 30 seconds: try again in 20 s/);
    // Another phone is free; every phone is not, since the Pixel is in its wait.
    assert.equal(r.testPush.send(TAB).status, 202);
    assert.equal(r.testPush.send(null).status, 429);
    r.tick(TEST_PUSH_COOLDOWN_MS);
    assert.equal(r.testPush.send(null).status, 202);
    assert.equal(r.snapshot.events({}).events.length, 3, 'a refused one is not recorded');
  } finally {
    r.close();
  }
});

test('refused: push off (409 push_off), no phone (409), an unknown phone (404); nothing recorded', () => {
  const r = rig();
  try {
    r.channels.enabled = false;
    const off = r.testPush.send(null);
    assert.deepEqual([off.status, off.code], [409, 'push_off']);
    assert.match(off.error, /VAPID_PUBLIC_KEY/);
    r.channels.enabled = true;
    assert.equal(r.testPush.send('0123456789ab').status, 404);
    assert.equal(r.snapshot.events({}).events.length, 0);
  } finally {
    r.close();
  }
  const none = rig([]);
  try {
    const out = none.testPush.send(null);
    assert.deepEqual([out.status, out.code], [409, 'no_devices']);
  } finally {
    none.close();
  }
});

test('a phone with push switched off in the app gets none, and says so; categories never hold a test push back', async () => {
  const r = rig();
  try {
    r.store.setPrefs('tok-pixel', { ...DEFAULT_PREFS, enabled: false });
    const noCategories = Object.fromEntries(
      Object.keys(DEFAULT_PREFS.categories).map((k) => [k, false])
    );
    r.store.setPrefs('tok-tab', {
      ...DEFAULT_PREFS,
      categories: noCategories,
      notifyRecoveries: false,
    });
    r.testPush.send(null);
    await r.settle();
    assert.deepEqual(
      r.channels.sent.map((s) => s.token),
      ['tok-tab']
    );
    const last = r.testPush.last();
    assert.deepEqual(
      last.results.map((p) => [p.device, p.state, p.sentence]),
      [
        [PIXEL, 'off', 'Not sent: push is switched off for this device.'],
        [TAB, 'sent', last.results[1].sentence],
      ]
    );
    assert.equal(last.sentence, 'Delivered to 1 of 2 phones.');
  } finally {
    r.close();
  }
});

test('a failed send says why in words, never its code, and the phone keeps it as its last error until one is accepted', async () => {
  let pixel = INTERNAL;
  const r = rig(['tok-pixel', 'tok-tab'], { 'tok-pixel': () => pixel, 'tok-tab': REFUSED });
  try {
    r.testPush.send(null);
    await r.settle();
    const last = r.testPush.last();
    assert.equal(last.done, false, 'the Pixel is tried again');
    assert.deepEqual(
      last.results.map((p) => [p.state, p.sentence]),
      [
        ['retrying', "Not delivered yet: The browser's push service failed on it; JagHelm tries again."],
        [
          'failed',
          "Failed: The browser's push service refused JagHelm's VAPID key (check VAPID_SUBJECT and the key pair).",
        ],
      ]
    );
    assert.ok(!JSON.stringify(last).includes('webpush/'), 'no send code reaches the client');
    assert.deepEqual(r.store.getToken('tok-pixel').lastError, {
      at: T0,
      code: 'webpush/server-error',
    });
    assert.equal(r.store.getToken('tok-tab').lastError.code, 'webpush/rejected');

    // Accepted later: the error goes.
    pixel = OK;
    r.store.markDelivered(['tok-pixel']);
    assert.equal(r.store.getToken('tok-pixel').lastError, undefined);
  } finally {
    r.close();
  }
});

test('a dead token: the phone is removed, and the test push says so', async () => {
  const r = rig(['tok-pixel'], { 'tok-pixel': DEAD });
  try {
    r.testPush.send(PIXEL);
    await r.settle();
    const [result] = r.testPush.last().results;
    assert.equal(result.state, 'removed');
    assert.match(result.sentence, /subscription has ended .*JagHelm removed this browser/);
    assert.equal(r.store.getDevices().length, 0);
  } finally {
    r.close();
  }
});

test('a phone removed before its test push went out is done with it', () => {
  const r = rig(['tok-pixel', 'tok-tab'], { 'tok-pixel': UNREACHABLE });
  try {
    r.testPush.send(null);
    r.store.removeDevice(TAB);
    const last = r.testPush.last();
    assert.deepEqual(
      last.results.map((p) => [p.device, p.state]),
      [
        [PIXEL, 'queued'],
        [TAB, 'removed'],
      ]
    );
    assert.equal(last.results[1].sentence, 'Not sent: the phone was removed first.');
  } finally {
    r.close();
  }
});

test('the push service out of reach: the test push waits on the server, and says so', async () => {
  const r = rig(['tok-pixel'], { 'tok-pixel': UNREACHABLE });
  try {
    r.testPush.send(PIXEL);
    await r.settle();
    assert.deepEqual(r.sender.stalled(), { since: T0, code: 'webpush/network-error' });
    const last = r.testPush.last();
    assert.equal(last.done, false);
    assert.equal(
      last.sentence,
      "Waiting: JagHelm couldn't reach the browser's push service; it tries again. It goes out once the push service answers."
    );
    assert.equal(r.store.getToken('tok-pixel').lastError, undefined, 'not one phone’s failure');
    assert.equal(r.snapshot.outbox().length, 1, 'still queued');
  } finally {
    r.close();
  }
});
