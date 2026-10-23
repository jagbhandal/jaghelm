/**
 * #579: the refresh cycle never waits on Google. It diffs, puts the cycle's
 * events in the outbox with the snapshot it advanced to (one write of one
 * file), and returns; one sender drains the outbox oldest first, one send at a
 * time, and sends an event again only for a failure that says nothing about it
 * or the phone (Google out of reach or failing). A phone Google keeps failing
 * holds up no other phone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPushSnapshot, OUTBOX_CAP, runPushCycle } from './dispatch.js';
import { createPushSender, GIVE_UP_TRIES, RETRY_BACKOFF_MS } from './outbox.js';
import { atomicWriteFileSync } from '../util/atomicWrite.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const T0 = 1_782_345_600_000;

const OK = { ok: true, prune: false };
/** Google out of reach: every phone would fail the same way. */
const UNREACHABLE = { ok: false, prune: false, retry: true, allPhones: true, error: 'app/network-error' };
/** Google failing this send: worth trying again, for this phone. */
const INTERNAL = { ok: false, prune: false, retry: true, allPhones: false, error: 'messaging/internal-error' };

/** A snapshot with services a to f on n1, each up unless named down. */
const board = (...down) => ({
  services: Object.fromEntries(
    ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => [`n1:${s}`, down.includes(s) ? 'down' : 'up'])
  ),
  hosts: {},
  ups: { state: 'online' },
  cron: {},
});

/** A snapshot with host n1's CPU at `cpu`. */
const cpuAt = (cpu) => ({
  services: {},
  hosts: { n1: { reachable: true, levels: { cpu, disk: 'ok', mem: 'ok' } } },
  ups: { state: 'online' },
  cron: {},
});

/** Phones that take every event. */
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
    async answer(result = OK) {
      waiting.shift()(result);
      await settle();
    },
    get waiting() {
      return waiting.length;
    },
  };
  return fcm;
}

/**
 * An FCM that answers at once: `answer(token, event)` gives each result, or
 * `results[n]` for its nth send (then ok). Records every try.
 */
function answeringFcm(results = []) {
  const fcm = {
    sent: [],
    isPushEnabled: () => true,
    async sendToToken(token, event) {
      fcm.sent.push(`${token} ${event.type} ${event.id}`);
      if (typeof results === 'function') return results(token, event);
      return results[fcm.sent.length - 1] ?? OK;
    },
  };
  return fcm;
}

/** Let every queued promise callback run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * The sender's clock and its wait between tries. A wait never ends by itself:
 * `pass()` moves the clock to its end and ends it. Records each wait.
 */
function fakeTime(start = T0) {
  const time = {
    now: start,
    waits: [],
    end: null,
    clock: () => time.now,
    sleep(ms) {
      time.waits.push(ms);
      return new Promise((resolve) => {
        time.end = () => {
          time.now += ms;
          time.end = null;
          resolve();
        };
      });
    },
    async pass() {
      time.end();
      await settle();
    },
  };
  return time;
}

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-579-outbox-'));
  return { dir, path: join(dir, 'push-snapshot.json') };
}

/** JagHelm's push half over the snapshot file at `path`: a cycle, and the sender behind it. */
function pushHalf(path, { fcm, store = phones('p'), time = fakeTime(), write, cap, logger = silent } = {}) {
  const snapshot = createPushSnapshot({ path, write, cap, logger, now: time.clock });
  const sender = createPushSender({ outbox: snapshot, store, fcm, logger, sleep: time.sleep, now: time.clock });
  return {
    snapshot,
    sender,
    time,
    async cycle(snap) {
      await runPushCycle({ buildSnapshotFn: () => snap, store, fcm, snapshot, sender, logger });
      await settle();
    },
  };
}

/** A logger that keeps each line as { level, fields, msg }. */
function recording() {
  const lines = [];
  const at = (level) => (fields, msg) => lines.push({ level, fields, msg });
  return { lines, debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

const onDisk = (path) => JSON.parse(readFileSync(path, 'utf8'));
const pending = (snapshot) => snapshot.outbox().map((e) => `${e.type} ${e.id}`);

test('#579: a send that hangs holds up no cycle: each diffs, queues its events behind it and returns', async () => {
  const { dir, path } = tmp();
  const hanging = {
    isPushEnabled: () => true,
    sent: [],
    sendToToken: (t, e) => (hanging.sent.push(e.type), new Promise(() => {})),
  };
  const p = pushHalf(path, { fcm: hanging });
  try {
    await p.cycle(board());
    await p.cycle(board('a')); // its page hangs
    const queuedAt = p.time.now;
    // Each later cycle returns although the send never answers.
    for (const snap of [board('a', 'b'), board('b'), board('b', 'c')]) {
      p.time.now += 30_000;
      const done = await Promise.race([
        runPushCycle({ buildSnapshotFn: () => snap, store: phones('p'), fcm: hanging, snapshot: p.snapshot, sender: p.sender, logger: silent }).then(() => 'returned'),
        settle().then(() => 'waiting'),
      ]);
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
    assert.equal(p.snapshot.oldestQueuedAt(), queuedAt);
    const file = onDisk(path);
    assert.deepEqual(
      file.outbox.map((e) => [e.event.id, e.queuedAt - T0]),
      [['n1:a', 0], ['n1:b', 30_000], ['n1:a', 60_000], ['n1:c', 90_000]],
      'queued on disk with it, each with when it was queued'
    );
    assert.deepEqual(
      { ...file, outbox: undefined, history: undefined },
      { ...board('b', 'c'), outbox: undefined, history: undefined }
    );
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

test('#579: Google out of reach: the round stops, waits longer each time, and resumes for the phones still owed the event; later events wait behind it', async () => {
  const { dir, path } = tmp();
  const logger = recording();
  // p takes the first page; then Google is out of reach twice.
  const fcm = answeringFcm([OK, UNREACHABLE, UNREACHABLE]);
  const p = pushHalf(path, { fcm, store: phones('p', 'q'), logger });
  try {
    await p.cycle(board());
    await p.cycle(board('a'));
    await p.cycle(board('a', 'b')); // queued behind the page still owed to q; doesn't cut the wait short
    assert.deepEqual(p.time.waits, [RETRY_BACKOFF_MS[0]]);
    await p.time.pass();
    assert.deepEqual(p.time.waits, RETRY_BACKOFF_MS.slice(0, 2), 'a longer wait after the second failure');
    await p.time.pass();
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
    const dispatched = logger.lines.filter((l) => l.msg === 'push dispatched').map((l) => [l.fields.id, l.fields.sent]);
    assert.deepEqual(dispatched, [['n1:a', 2], ['n1:b', 2]], 'sent counts the phones that took it, not the tries');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579: a failure that hits every phone alike stops the round: the next phone is not tried', async () => {
  const { dir, path } = tmp();
  const fcm = answeringFcm([UNREACHABLE]);
  const p = pushHalf(path, { fcm, store: phones('p', 'q') });
  try {
    await p.cycle(board());
    await p.cycle(board('a'));
    assert.deepEqual(fcm.sent, ['p service_down n1:a']);
    await p.time.pass();
    await p.sender.idle();
    assert.deepEqual(fcm.sent, ['p service_down n1:a', 'p service_down n1:a', 'q service_down n1:a']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579 review: one phone Google keeps failing holds up no other: they get every event at once, in order; it gets each, in order, once Google takes it', async () => {
  const { dir, path } = tmp();
  let failA = true;
  const fcm = answeringFcm((token) => (token === 'A' && failA ? INTERNAL : OK));
  const p = pushHalf(path, { fcm, store: phones('A', 'B') });
  try {
    await p.cycle(board());
    await p.cycle(board('a'));
    await p.cycle(board('a', 'b')); // cuts the wait for A short, for B's sake
    await p.cycle(board('a', 'b', 'c'));
    assert.deepEqual(fcm.sent, [
      'A service_down n1:a',
      'B service_down n1:a',
      'B service_down n1:b',
      'B service_down n1:c',
    ], 'A is not tried again before its wait is up, nor sent a later event first');
    assert.deepEqual(pending(p.snapshot), ['service_down n1:a', 'service_down n1:b', 'service_down n1:c'], 'owed to A');

    failA = false;
    await p.time.pass();
    await p.sender.idle();
    assert.deepEqual(fcm.sent.slice(4), ['A service_down n1:a', 'A service_down n1:b', 'A service_down n1:c']);
    assert.deepEqual(pending(p.snapshot), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579 review: a phone Google keeps failing an event the others took is given up on for it after about an hour, with one warn line; then it gets the next', async () => {
  const { dir, path } = tmp();
  const logger = recording();
  const fcm = answeringFcm((token) => (token === 'A' ? INTERNAL : OK));
  const p = pushHalf(path, { fcm, store: phones('A', 'B'), logger });
  try {
    await p.cycle(board());
    await p.cycle(board('a'));
    while (pending(p.snapshot).length > 0) await p.time.pass();
    const tries = fcm.sent.filter((s) => s === 'A service_down n1:a').length;
    assert.equal(tries, GIVE_UP_TRIES);
    const waited = p.time.waits.reduce((a, b) => a + b, 0);
    assert.ok(waited > 50 * 60_000 && waited < 70 * 60_000, `about an hour (${waited / 60_000} min)`);
    const given = logger.lines.filter((l) => l.msg === 'push given up for one phone');
    assert.deepEqual(given.map((l) => l.fields), [
      { type: 'service_down', id: 'n1:a', token: 'A', tries: GIVE_UP_TRIES, code: 'messaging/internal-error' },
    ]);

    await p.cycle(board('a', 'b'));
    assert.deepEqual(fcm.sent.slice(-2), ['A service_down n1:b', 'B service_down n1:b'], 'A is tried for the next');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579 review: a page no phone has taken is never given up on: after a long outage it is still sent', async () => {
  const { dir, path } = tmp();
  let failing = true;
  const fcm = answeringFcm(() => (failing ? INTERNAL : OK));
  const p = pushHalf(path, { fcm });
  try {
    await p.cycle(board());
    await p.cycle(board('a'));
    for (let i = 0; i < 3 * GIVE_UP_TRIES; i += 1) await p.time.pass();
    assert.deepEqual(pending(p.snapshot), ['service_down n1:a']);
    failing = false;
    await p.time.pass();
    assert.deepEqual(pending(p.snapshot), []);
    assert.equal(fcm.sent.at(-1), 'p service_down n1:a');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579: a send that fails for the phone or the message is not sent again: a dead token is pruned, a payload error logged, and the next event goes', async () => {
  const { dir, path } = tmp();
  const fcm = answeringFcm([
    { ok: false, prune: true, retry: false, allPhones: false, error: 'messaging/registration-token-not-registered' },
    { ok: false, prune: false, retry: false, allPhones: false, error: 'messaging/invalid-argument' },
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
    assert.deepEqual(p.time.waits, [], 'no retry');
    assert.deepEqual(pending(p.snapshot), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579: a restart with sends pending sends each once, in order, and the next cycle re-diffs nothing (real file)', async () => {
  const { dir, path } = tmp();
  try {
    const before = pushHalf(path, { fcm: answeringFcm([UNREACHABLE]) });
    await before.cycle(board());
    await before.cycle(board('a'));
    await before.cycle(board('a', 'b'));
    assert.deepEqual(pending(before.snapshot), ['service_down n1:a', 'service_down n1:b']);
    // JagHelm stops while the sender waits to retry: nothing is flushed, the file has it all.

    const fcm = answeringFcm();
    const after = pushHalf(path, { fcm });
    await after.cycle(board('a', 'b')); // the same board: nothing new to send
    await after.sender.idle();
    await after.cycle(board('a', 'b'));
    await after.sender.idle();
    assert.deepEqual(fcm.sent, ['p service_down n1:a', 'p service_down n1:b']);
    assert.deepEqual({ ...onDisk(path), history: undefined }, { ...board('a', 'b'), history: undefined }, 'sent: off the file');
    assert.deepEqual(
      onDisk(path).history.events.map((e) => [e.key, e.push.state]),
      [['n1:a', 'sent'], ['n1:b', 'sent']],
      'recorded once each (#267)'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579: one write puts the advanced snapshot and its events on disk before the first send, so a crash on either side of it loses and doubles nothing', async () => {
  const { dir, path } = tmp();
  const steps = [];
  const write = (file, data) => {
    const { outbox = [], ...snap } = JSON.parse(data);
    steps.push(`write ${snap.services['n1:a']} [${outbox.map((e) => e.event.type)}]`);
    atomicWriteFileSync(file, data);
  };
  const crashedBefore = join(dir, 'crash-before-write.json');
  const crashedAfter = join(dir, 'crash-before-send.json');
  const fcm = {
    isPushEnabled: () => true,
    async sendToToken(token, event) {
      steps.push(`send ${event.type}`);
      copyFileSync(path, crashedAfter); // the disk as a crash at this send leaves it
      return OK;
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

// ── Collapse and the bound (#579 review) ───────────────────────────────────

test('#579 review: a page no phone has seen and its recovery both leave the outbox: neither is sent', async () => {
  const { dir, path } = tmp();
  let reachable = false;
  const fcm = answeringFcm(() => (reachable ? OK : UNREACHABLE));
  const p = pushHalf(path, { fcm });
  try {
    await p.cycle(board());
    await p.cycle(board('a')); // Google out of reach: unsent
    await p.cycle(board('b')); // a recovers, b goes down
    assert.deepEqual(pending(p.snapshot), ['service_down n1:b']);
    assert.deepEqual(onDisk(path).outbox.map((e) => e.event.id), ['n1:b']);
    reachable = true;
    await p.time.pass();
    await p.sender.idle();
    assert.deepEqual(fcm.sent.slice(1), ['p service_down n1:b']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579 review: a page a phone has seen keeps its recovery, also after a restart', async () => {
  const { dir, path } = tmp();
  const fcm = answeringFcm((token) => (token === 'A' ? INTERNAL : OK));
  try {
    const before = pushHalf(path, { fcm, store: phones('A', 'B') });
    await before.cycle(board());
    await before.cycle(board('a')); // B took it; A is owed it
    assert.deepEqual(onDisk(path).outbox.map((e) => [e.event.id, e.sent]), [['n1:a', true]], 'kept on disk');

    const after = pushHalf(path, { fcm, store: phones('A', 'B') });
    await after.cycle(board('a'));
    await after.cycle(board());
    assert.deepEqual(pending(after.snapshot), ['service_down n1:a', 'service_recovered n1:a']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579 review: an escalation no phone has seen still goes out with the clear when the first page was seen', async () => {
  const { dir, path } = tmp();
  let reachable = true;
  const fcm = answeringFcm(() => (reachable ? OK : UNREACHABLE));
  const p = pushHalf(path, { fcm });
  try {
    await p.cycle(cpuAt('ok'));
    await p.cycle(cpuAt('warn')); // sent
    reachable = false;
    await p.cycle(cpuAt('crit')); // unsent
    await p.cycle(cpuAt('ok'));
    assert.deepEqual(pending(p.snapshot), ['host_threshold n1:cpu', 'host_threshold_cleared n1:cpu']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579: the outbox is bounded: past its cap the oldest pages no phone is being sent are dropped, with one warn line naming them; a recovery whose page went out never is', async () => {
  const { dir, path } = tmp();
  const logger = recording();
  const fcm = heldFcm();
  const p = pushHalf(path, { fcm, cap: 3, logger });
  const warns = () => logger.lines.filter((l) => l.level === 'warn');
  try {
    await p.cycle(board());
    await p.cycle(board('a')); // in flight: never dropped
    await p.cycle(board('a', 'b', 'c')); // 3 queued
    await p.cycle(board('a', 'b', 'c', 'd', 'e')); // 5: two over
    assert.deepEqual(pending(p.snapshot), ['service_down n1:a', 'service_down n1:d', 'service_down n1:e']);
    assert.equal(onDisk(path).outbox.length, 3, 'the file is bounded too');
    assert.deepEqual(warns().map((l) => [l.msg, l.fields]), [
      ['push outbox full: dropped the oldest unsent pushes', { cap: 3, dropped: ['service_down n1:b', 'service_down n1:c'] }],
    ]);

    // b and c recover: their pages were dropped unsent, so their recoveries go too.
    await p.cycle(board('a', 'd', 'e'));
    assert.deepEqual(pending(p.snapshot), ['service_down n1:a', 'service_down n1:d', 'service_down n1:e']);
    // a recovers: its page is being sent, so the recovery stays, and a page goes instead.
    await p.cycle(board('d', 'e'));
    assert.deepEqual(pending(p.snapshot), ['service_down n1:a', 'service_down n1:e', 'service_recovered n1:a']);
    assert.deepEqual(warns().at(-1).fields, { cap: 3, dropped: ['service_down n1:d'] });

    while (fcm.waiting > 0) await fcm.answer();
    await p.sender.idle();
    assert.deepEqual(fcm.sent, ['p service_down n1:a', 'p service_down n1:e', 'p service_recovered n1:a']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#579: the cap is 100 pushes, and a phone is given up on for an event after 16 tries', () => {
  assert.equal(OUTBOX_CAP, 100);
  assert.equal(GIVE_UP_TRIES, 16);
});

test('#579: push off (no FCM creds): no outbox, nothing sent; the file holds the snapshot and the history (#267)', async () => {
  const { dir, path } = tmp();
  const fcm = { ...answeringFcm(), isPushEnabled: () => false };
  const p = pushHalf(path, { fcm });
  try {
    await p.cycle(board());
    await p.cycle(board('a'));
    await p.sender.idle();
    assert.equal(onDisk(path).outbox, undefined);
    assert.deepEqual(onDisk(path).history.events.map((e) => [e.key, e.push.state]), [['n1:a', 'off']]);
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
    assert.equal(old.snapshot.oldestQueuedAt(), null);

    const event = { type: 'service_down', id: 'n1:a', node: 'n1', title: 'Service down', body: 'a', severity: 'critical' };
    writeFileSync(path, JSON.stringify({ ...board('a'), outbox: [{ queuedAt: T0 - 5_000, event }] }));
    const fcm = answeringFcm();
    const resumed = pushHalf(path, { fcm });
    assert.deepEqual(resumed.snapshot.prev(), board('a'), 'the outbox is not part of the snapshot');
    assert.equal(resumed.snapshot.oldestQueuedAt(), T0 - 5_000);
    await resumed.cycle(board('a'));
    await resumed.sender.idle();
    assert.deepEqual(fcm.sent, ['p service_down n1:a']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── #581: producers other than the refresh loop (the Arcane poller, the digest) ──

const offline = { type: 'arcane_agent_offline', id: 'arcane:pi-2:agent', node: 'pi-2', title: 'Arcane · pi-2', body: 'Agent disconnected', severity: 'warning' };
const back = { ...offline, type: 'arcane_agent_recovered', body: 'Agent reconnected', severity: 'info' };
const update = { type: 'arcane_update', id: 'arcane:vm-103:update', node: 'vm-103', title: 'Updates · vm-103', body: '1 updated: gitea', severity: 'info' };

test("#581: notify writes a producer's state with its events recorded and queued, in one write; the next process reads it back", async () => {
  const { dir, path } = tmp();
  let writes = 0;
  const write = (file, data) => {
    writes += 1;
    atomicWriteFileSync(file, data);
  };
  const fcm = heldFcm();
  const p = pushHalf(path, { fcm, write });
  try {
    await p.cycle(board());
    writes = 0;
    const state = { seen: ['run-1'] };
    p.snapshot.notify('arcane', state, [update]);
    state.seen.push('run-2'); // the producer's later changes stay out of the file until its next notify
    assert.equal(writes, 1);
    const file = onDisk(path);
    assert.deepEqual(file.producers, { arcane: { seen: ['run-1'], savedAt: T0 } }, 'with when it was written (#581 review)');
    assert.deepEqual(file.outbox.map((e) => e.event), [update]);
    assert.deepEqual(file.history.events.map((e) => [e.type, e.push.state]), [['arcane_update', 'queued']]);
    assert.equal(file.services['n1:a'], 'up', "push's snapshot as it was");

    // The refresh loop's own writes keep it.
    await p.cycle(board('a'));
    assert.deepEqual(onDisk(path).producers, { arcane: { seen: ['run-1'], savedAt: T0 } });
    const next = createPushSnapshot({ path, logger: silent });
    assert.deepEqual(next.producerState('arcane'), { savedAt: T0, state: { seen: ['run-1'] } });
    assert.equal(next.producerState('arcane-vulns'), undefined);
    assert.equal(next.unreadable(), false);
    assert.deepEqual(next.prev(), board('a'), 'not a snapshot field');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#581: a producer's agent offline and its recovery, both unsent, leave the outbox together; push off records them off and queues nothing", () => {
  const { dir, path } = tmp();
  try {
    const on = createPushSnapshot({ path, logger: silent, now: () => T0 });
    on.notify('arcane', { n: 1 }, [offline]);
    on.notify('arcane', { n: 2 }, [update]);
    on.notify('arcane', { n: 3 }, [back]);
    assert.deepEqual(pending(on), ['arcane_update arcane:vm-103:update']);
    assert.deepEqual(
      on.events().events.map((e) => [e.type, e.push.state]),
      [
        ['arcane_agent_recovered', 'dropped'],
        ['arcane_update', 'queued'],
        ['arcane_agent_offline', 'dropped'],
      ]
    );

    const off = createPushSnapshot({ path: join(dir, 'off.json'), logger: silent, now: () => T0 });
    off.notify('arcane', { n: 1 }, [offline], { push: false });
    assert.deepEqual(off.outbox(), []);
    assert.deepEqual(off.events().events.map((e) => [e.type, e.push.state]), [['arcane_agent_offline', 'off']]);
    assert.deepEqual(onDisk(join(dir, 'off.json')).producers, { arcane: { n: 1, savedAt: T0 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#581: a file that does not parse is unreadable(): what it held, producers too, is gone, and the warning says what Arcane may miss or repeat, quoting nothing', () => {
  const { dir, path } = tmp();
  try {
    const log = recording();
    writeFileSync(path, '{"producers":{"arcane":{"savedAt":1,"state":{"envs":{"vm-hunter2":{"known":true}}}},"arcane-vulns":{"savedAt":2,"vulns":{');
    const s = createPushSnapshot({ path, logger: log, now: () => T0 });
    assert.equal(s.unreadable(), true);
    assert.equal(s.producerState('arcane'), undefined);
    const [warn] = log.lines.filter((l) => l.level === 'warn');
    assert.match(warn.msg, /Arcane state; Arcane starts from silent baselines, so what changed since its last write is not pushed, and an Arcane release or offline agent already pushed may be pushed again$/);
    assert.equal(warn.fields.producers, 2);
    assert.doesNotMatch(JSON.stringify(log.lines), /hunter2/);
    assert.equal(createPushSnapshot({ path: join(dir, 'none.json'), logger: silent }).unreadable(), false, 'no file is not unreadable');

    // One that can't be read at all (here a directory): the same.
    const dirLog = recording();
    const notAFile = join(dir, 'a-directory.json');
    mkdirSync(notAFile);
    const d = createPushSnapshot({ path: notAFile, logger: dirLog, now: () => T0 });
    assert.equal(d.unreadable(), true);
    assert.match(dirLog.lines[0].msg, /^unreadable push snapshot, starting with no previous state, outbox, history or Arcane state; Arcane starts from silent baselines/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
