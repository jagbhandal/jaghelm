/**
 * #579: the refresh cycle never waits on Google. It diffs, puts the cycle's
 * events in the outbox with the snapshot it advanced to (one write of one
 * file), and returns; one sender drains the outbox in order, one event at a
 * time, and sends an event again only for a failure that says nothing about it
 * or the phone (Google out of reach or failing).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPushSnapshot, OUTBOX_CAP, runPushCycle } from './dispatch.js';
import { createPushSender, RETRY_BACKOFF_MS } from './outbox.js';
import { atomicWriteFileSync } from '../util/atomicWrite.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** A snapshot with services a, b and c on n1, each up unless named down. */
const board = (...down) => ({
  services: Object.fromEntries(['a', 'b', 'c'].map((s) => [`n1:${s}`, down.includes(s) ? 'down' : 'up'])),
  hosts: {},
  ups: { state: 'online' },
  cron: {},
});

/** One phone, or several, that take every event. */
function phones(...tokens) {
  const removed = [];
  const delivered = [];
  return {
    removed,
    delivered,
    getAllTokens: () => tokens.filter((t) => !removed.includes(t)).map((token) => ({ token })),
    getPrefs: () => ({
      enabled: true,
      notifyRecoveries: true,
      categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
    }),
    removeToken: (t) => removed.push(t),
    pruneStale: () => 0,
    markDelivered: (list) => delivered.push(...list),
  };
}

/**
 * An FCM whose every send waits until the test answers it: `answer(result)`
 * settles the oldest send still waiting. Records each send as "token type id",
 * and the most sends ever in flight at once.
 */
function heldFcm() {
  const waiting = [];
  let inFlight = 0;
  const fcm = {
    sent: [],
    maxInFlight: 0,
    isPushEnabled: () => true,
    sendToToken(token, event) {
      fcm.sent.push(`${token} ${event.type} ${event.id}`);
      inFlight += 1;
      fcm.maxInFlight = Math.max(fcm.maxInFlight, inFlight);
      return new Promise((resolve) => {
        waiting.push((result) => {
          inFlight -= 1;
          resolve(result);
        });
      });
    },
    /** Settle the oldest waiting send, then let the sender move on. */
    async answer(result = { ok: true, prune: false }) {
      waiting.shift()(result);
      await settle();
    },
    get waiting() {
      return waiting.length;
    },
  };
  return fcm;
}

/** An FCM that answers at once, `results[n]` for its nth send (then ok). */
function answeringFcm(results = []) {
  const fcm = {
    sent: [],
    isPushEnabled: () => true,
    async sendToToken(token, event) {
      fcm.sent.push(`${token} ${event.type} ${event.id}`);
      return results[fcm.sent.length - 1] ?? { ok: true, prune: false };
    },
  };
  return fcm;
}

/** Let every queued promise callback run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A sleep that never ends by itself: `wake()` ends the one the sender is in. Records each wait. */
function heldSleep() {
  const sleep = (ms) => {
    sleep.waits.push(ms);
    return new Promise((resolve) => {
      sleep.wake = resolve;
    });
  };
  sleep.waits = [];
  sleep.wake = null;
  return sleep;
}

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-579-outbox-'));
  return { dir, path: join(dir, 'push-snapshot.json') };
}

/** JagHelm's push half over the snapshot file at `path`: a cycle, and the sender behind it. */
function pushHalf(path, { fcm, store = phones('p'), sleep = heldSleep(), write, cap, logger = silent } = {}) {
  const snapshot = createPushSnapshot({ path, write, cap, logger });
  const sender = createPushSender({ outbox: snapshot, store, fcm, logger, sleep });
  return {
    snapshot,
    sender,
    sleep,
    cycle: (snap) =>
      runPushCycle({ buildSnapshotFn: () => snap, store, fcm, snapshot, sender, logger }),
  };
}

const onDisk = (path) => JSON.parse(readFileSync(path, 'utf8'));
const pending = (snapshot) => snapshot.outbox().map((e) => `${e.type} ${e.id}`);

test('#579: a send that hangs holds up no cycle: each diffs, queues its events behind it and returns', async () => {
  const { dir, path } = tmp();
  const hanging = { isPushEnabled: () => true, sent: [], sendToToken: (t, e) => (hanging.sent.push(e.type), new Promise(() => {})) };
  const p = pushHalf(path, { fcm: hanging });
  try {
    await p.cycle(board());
    await p.cycle(board('a')); // its page hangs
    // Each later cycle returns although the send never answers.
    for (const snap of [board('a', 'b'), board('b'), board('b', 'c')]) {
      const done = await Promise.race([p.cycle(snap).then(() => 'returned'), settle().then(() => 'waiting')]);
      assert.equal(done, 'returned');
    }
    assert.deepEqual(hanging.sent, ['service_down'], 'one send in flight, no other started');
    assert.deepEqual(p.snapshot.prev(), board('b', 'c'), 'the snapshot advanced every cycle');
    assert.deepEqual(pending(p.snapshot), [
      'service_down n1:a',
      'service_down n1:b',
      'service_recovered n1:a',
      'service_down n1:c',
    ]);
    const file = onDisk(path);
    assert.deepEqual(file.outbox.map((e) => e.id), ['n1:a', 'n1:b', 'n1:a', 'n1:c'], 'queued on disk with it');
    assert.deepEqual({ ...file, outbox: undefined }, { ...board('b', 'c'), outbox: undefined });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#579: consecutive cycles' events go out once each, in order, one at a time", async () => {
  const { dir, path } = tmp();
  const fcm = heldFcm();
  const p = pushHalf(path, { fcm, store: phones('p', 'q') });
  try {
    await p.cycle(board());
    await p.cycle(board('a'));
    await p.cycle(board('a', 'b'));
    await p.cycle(board('b'));
    await p.cycle(board('b')); // nothing changed: nothing more queued
    while (fcm.waiting > 0) await fcm.answer();
    await p.sender.idle();
    assert.deepEqual(fcm.sent, [
      'p service_down n1:a',
      'q service_down n1:a',
      'p service_down n1:b',
      'q service_down n1:b',
      'p service_recovered n1:a',
      'q service_recovered n1:a',
    ]);
    assert.equal(fcm.maxInFlight, 1, 'never two sends at once');
    assert.deepEqual(pending(p.snapshot), []);
    assert.equal(onDisk(path).outbox, undefined, 'an empty outbox leaves the file as before #579');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579: a send Google fails is sent again after a backoff, to the phones still owed it, and the next event waits behind it', async () => {
  const { dir, path } = tmp();
  const unreachable = { ok: false, prune: false, retry: true, error: 'app/network-error' };
  // p takes the first page, q's send fails twice, then everything goes.
  const fcm = answeringFcm([{ ok: true, prune: false }, unreachable, unreachable]);
  const p = pushHalf(path, { fcm, store: phones('p', 'q') });
  try {
    await p.cycle(board());
    await p.cycle(board('a'));
    await settle();
    await p.cycle(board('a', 'b')); // queued behind the page still owed to q
    assert.deepEqual(p.sleep.waits, [RETRY_BACKOFF_MS[0]]);
    p.sleep.wake();
    await settle();
    assert.deepEqual(p.sleep.waits, RETRY_BACKOFF_MS.slice(0, 2), 'a longer wait after the second failure');
    p.sleep.wake();
    await p.sender.idle();
    assert.deepEqual(fcm.sent, [
      'p service_down n1:a',
      'q service_down n1:a',
      'q service_down n1:a',
      'q service_down n1:a',
      'p service_down n1:b',
      'q service_down n1:b',
    ]);
    assert.deepEqual(pending(p.snapshot), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579: a send that fails for the phone or the message is not sent again: a dead token is pruned, a payload error logged, and the next event goes', async () => {
  const { dir, path } = tmp();
  const fcm = answeringFcm([
    { ok: false, prune: true, retry: false, error: 'messaging/registration-token-not-registered' },
    { ok: false, prune: false, retry: false, error: 'messaging/invalid-argument' },
  ]);
  const store = phones('dead', 'p');
  const p = pushHalf(path, { fcm, store });
  try {
    await p.cycle(board());
    await p.cycle(board('a', 'b'));
    await p.sender.idle();
    assert.deepEqual(fcm.sent, ['dead service_down n1:a', 'p service_down n1:a', 'p service_down n1:b']);
    assert.deepEqual(store.removed, ['dead']);
    assert.deepEqual(store.delivered, ['p'], 'the accepted send keeps p alive (#247)');
    assert.deepEqual(p.sleep.waits, [], 'no retry');
    assert.deepEqual(pending(p.snapshot), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579: a restart with sends pending sends each once, in order, and the next cycle re-diffs nothing (real file)', async () => {
  const { dir, path } = tmp();
  const down = { ok: false, prune: false, retry: true, error: 'app/network-timeout' };
  try {
    const before = pushHalf(path, { fcm: answeringFcm([down]) });
    await before.cycle(board());
    await before.cycle(board('a'));
    await before.cycle(board('a', 'b'));
    await settle();
    assert.deepEqual(pending(before.snapshot), ['service_down n1:a', 'service_down n1:b']);
    // JagHelm stops while the sender waits to retry: nothing is flushed, the file has it all.

    const fcm = answeringFcm();
    const after = pushHalf(path, { fcm });
    await after.cycle(board('a', 'b')); // the same board: nothing new to send
    await after.sender.idle();
    await after.cycle(board('a', 'b'));
    await after.sender.idle();
    assert.deepEqual(fcm.sent, ['p service_down n1:a', 'p service_down n1:b']);
    assert.deepEqual(onDisk(path), board('a', 'b'), 'sent: off the file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579: one write puts the advanced snapshot and its events on disk before the first send, so a crash on either side of it loses and doubles nothing', async () => {
  const { dir, path } = tmp();
  const steps = [];
  const write = (file, data) => {
    const { outbox = [], ...snap } = JSON.parse(data);
    steps.push(`write ${snap.services['n1:a']} [${outbox.map((e) => e.type)}]`);
    atomicWriteFileSync(file, data);
  };
  const crashedBefore = join(dir, 'crash-before-write.json');
  const crashedAfter = join(dir, 'crash-before-send.json');
  const fcm = {
    isPushEnabled: () => true,
    async sendToToken(token, event) {
      steps.push(`send ${event.type}`);
      copyFileSync(path, crashedAfter); // the disk as a crash at this send leaves it
      return { ok: true, prune: false };
    },
  };
  try {
    const p = pushHalf(path, { fcm, write });
    await p.cycle(board());
    copyFileSync(path, crashedBefore); // the disk as a crash inside the next cycle, before its write, leaves it
    await p.cycle(board('a'));
    await p.sender.idle();
    assert.deepEqual(steps, [
      'write up []',
      'write down [service_down]', // one write: the snapshot moves and the page is queued together
      'send service_down',
      'write down []', // sent: off the outbox
    ]);

    // A crash before the write: the file is the last cycle's, so the restart diffs and pages, once.
    for (const [file, why] of [
      [crashedBefore, 'crash before the write: diffed again'],
      [crashedAfter, 'crash between the write and the send: sent from the outbox'],
    ]) {
      const again = answeringFcm();
      const restarted = pushHalf(file, { fcm: again });
      await restarted.cycle(board('a'));
      await restarted.sender.idle();
      await restarted.cycle(board('a'));
      await restarted.sender.idle();
      assert.deepEqual(again.sent, ['p service_down n1:a'], why);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579: the outbox is bounded: past its cap the oldest unsent events are dropped, with one warn line naming them', async () => {
  const { dir, path } = tmp();
  const warns = [];
  const logger = { ...silent, warn: (fields, msg) => warns.push({ fields, msg }) };
  const fcm = heldFcm();
  const p = pushHalf(path, { fcm, cap: 3, logger });
  try {
    await p.cycle(board());
    await p.cycle(board('a')); // in flight: never dropped
    await p.cycle(board('a', 'b', 'c')); // 3 queued
    await p.cycle(board('c')); // 5: two over
    assert.deepEqual(pending(p.snapshot), [
      'service_down n1:a',
      'service_recovered n1:a',
      'service_recovered n1:b',
    ]);
    assert.equal(onDisk(path).outbox.length, 3, 'the file is bounded too');
    assert.equal(warns.length, 1);
    assert.equal(warns[0].msg, 'push outbox full: dropped the oldest unsent pushes');
    assert.deepEqual(warns[0].fields, { cap: 3, dropped: ['service_down n1:b', 'service_down n1:c'] });

    while (fcm.waiting > 0) await fcm.answer();
    await p.sender.idle();
    assert.deepEqual(fcm.sent, ['p service_down n1:a', 'p service_recovered n1:a', 'p service_recovered n1:b']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579: the cap is 100 pushes', () => {
  assert.equal(OUTBOX_CAP, 100);
});

test('#579: push off (no FCM creds): no file, no outbox, nothing sent', async () => {
  const { dir, path } = tmp();
  const fcm = { ...answeringFcm(), isPushEnabled: () => false };
  const p = pushHalf(path, { fcm });
  try {
    await p.cycle(board());
    await p.cycle(board('a'));
    await p.sender.idle();
    assert.equal(existsSync(path), false);
    assert.deepEqual(fcm.sent, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579: a file an older JagHelm wrote (no outbox) is read as before; one with an outbox resumes it', async () => {
  const { dir, path } = tmp();
  try {
    writeFileSync(path, JSON.stringify(board('a')));
    const old = pushHalf(path, { fcm: answeringFcm() });
    assert.deepEqual(old.snapshot.prev(), board('a'));
    assert.deepEqual(pending(old.snapshot), []);

    const queued = { type: 'service_down', id: 'n1:a', node: 'n1', title: 'Service down', body: 'a', severity: 'critical' };
    writeFileSync(path, JSON.stringify({ ...board('a'), outbox: [queued] }));
    const fcm = answeringFcm();
    const resumed = pushHalf(path, { fcm });
    assert.deepEqual(resumed.snapshot.prev(), board('a'), 'the outbox is not part of the snapshot');
    await resumed.cycle(board('a'));
    await resumed.sender.idle();
    assert.deepEqual(fcm.sent, ['p service_down n1:a']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
