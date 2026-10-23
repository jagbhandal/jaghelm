/**
 * #267 through the push cycle: every event the differ makes is recorded,
 * with push set up or not, in the one atomic write that advances the snapshot
 * (and queues the pushes, #579), so a crash on either side of that write
 * neither loses an event nor records one twice. What push did with each is
 * kept beside it: off, queued, sent to how many phones, suppressed by their
 * settings, unsent, or dropped by the outbox.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPushSnapshot, runPushCycle } from './dispatch.js';
import { createPushSender } from './outbox.js';
import { atomicWriteFileSync } from '../util/atomicWrite.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const T0 = 1_782_345_600_000;

/** A snapshot with services a to c on n1, each up unless named down. */
const board = (...down) => ({
  services: Object.fromEntries(['a', 'b', 'c'].map((s) => [`n1:${s}`, down.includes(s) ? 'down' : 'up'])),
  hosts: {},
  ups: { state: 'online' },
  cron: {},
});

const PREFS_ALL = {
  enabled: true,
  notifyRecoveries: true,
  categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
};

/** Phones, each with its prefs (all on unless given). */
function phones(prefsOf = {}, ...tokens) {
  return {
    getAllTokens: () => tokens.map((token) => ({ token })),
    getPrefs: (token) => prefsOf[token] ?? PREFS_ALL,
    removeToken: () => true,
    pruneStale: () => 0,
    markDelivered: () => 0,
  };
}

const fcmOff = () => ({
  sent: [],
  isPushEnabled: () => false,
  sendToToken: async () => {
    throw new Error('push is off: nothing is sent');
  },
});
function fcmOn() {
  const fcm = {
    sent: [],
    isPushEnabled: () => true,
    sendToToken: async (token, event) => {
      fcm.sent.push(`${token} ${event.type} ${event.id}`);
      return { ok: true, prune: false };
    },
  };
  return fcm;
}

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-267-'));
  return { dir, path: join(dir, 'push-snapshot.json') };
}

/** Records every write that landed (parsed), then really writes it; attempts in `failOn` throw. */
function writeSpy({ failOn = [] } = {}) {
  const spy = {
    written: [],
    attempts: 0,
    write(path, data) {
      spy.attempts += 1;
      if (failOn.includes(spy.attempts)) throw new Error('killed mid-cycle');
      spy.written.push(JSON.parse(data));
      atomicWriteFileSync(path, data);
    },
  };
  return spy;
}

/**
 * The push half of JagHelm over the file at `path`: a cycle builds `snap`,
 * diffs and advances, then waits for the sends it queued. A new one on the
 * same path is JagHelm after a restart.
 */
function pushHalf(path, { fcm, store = phones({}, 'p'), write, logger = silent } = {}) {
  const time = { now: T0 };
  const snapshot = createPushSnapshot({ path, logger, now: () => time.now, ...(write ? { write } : {}) });
  const woken = { count: 0 };
  const real = createPushSender({ outbox: snapshot, store, fcm, logger: silent, sleep: () => new Promise(() => {}) });
  const sender = {
    wake() {
      woken.count += 1;
      real.wake();
    },
    idle: () => real.idle(),
  };
  return {
    snapshot,
    time,
    woken,
    async cycle(snap) {
      await runPushCycle({ buildSnapshotFn: () => snap, store, fcm, snapshot, sender, logger: silent });
      await sender.idle();
      time.now += 30_000;
    },
  };
}

const history = (p, query) => p.snapshot.events(query).events;
const brief = (p) => history(p).map((e) => `${e.id} ${e.type} ${e.key} ${e.push.state}`);
const onDisk = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('#267: push off (no FCM creds): every change is recorded, nothing is queued or sent, and the file keeps it across a restart', async () => {
  const { dir, path } = tmp();
  const fcm = fcmOff();
  try {
    const p = pushHalf(path, { fcm });
    await p.cycle(board());
    await p.cycle(board('a'));
    await p.cycle(board('a')); // nothing changed
    await p.cycle(board());
    assert.deepEqual(brief(p), ['2 service_recovered n1:a off', '1 service_down n1:a off']);
    assert.deepEqual(history(p)[1].at, new Date(T0 + 30_000).toISOString(), 'when the cycle saw it');
    assert.deepEqual(fcm.sent, []);
    assert.equal(p.woken.count, 0, 'the sender is never woken');
    assert.deepEqual(p.snapshot.outbox(), []);
    const file = onDisk(path);
    assert.equal(file.outbox, undefined, 'nothing queued');
    assert.deepEqual(file.history.events.map((e) => e.id), ['1', '2']);

    const restarted = pushHalf(path, { fcm });
    assert.deepEqual(brief(restarted), brief(p), 'the same history after a restart');
    await restarted.cycle(board());
    assert.deepEqual(brief(restarted), brief(p), 'and nothing diffed again');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#267: push on: recorded as queued in the write that queues the page, then what the phones did', async () => {
  const { dir, path } = tmp();
  const spy = writeSpy();
  const fcm = fcmOn();
  const quiet = { ...PREFS_ALL, categories: { ...PREFS_ALL.categories, service: false } };
  try {
    const p = pushHalf(path, { fcm, store: phones({ q: quiet }, 'p', 'q', 'r'), write: spy.write });
    await p.cycle(board());
    await p.cycle(board('a'));
    assert.deepEqual(fcm.sent, ['p service_down n1:a', 'r service_down n1:a']);
    const queuedWrite = spy.written[1];
    assert.deepEqual(
      [queuedWrite.outbox.map((e) => [e.event.id, e.historyId]), queuedWrite.history.events.map((e) => [e.id, e.push.state])],
      [[['n1:a', '1']], [['1', 'queued']]],
      'one write: the snapshot moved, the page queued and recorded'
    );
    assert.deepEqual(history(p)[0].push, { state: 'sent', phones: 2, suppressed: 1 });
    assert.deepEqual(onDisk(path).history.events[0].push, { state: 'sent', phones: 2, suppressed: 1 }, 'on disk too');
    assert.equal(onDisk(path).outbox, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#267: push on: suppressed when every phone has it switched off, unsent with no phone', async () => {
  const { dir, path } = tmp();
  const off = { ...PREFS_ALL, notifyRecoveries: false };
  try {
    const p = pushHalf(path, { fcm: fcmOn(), store: phones({ p: off }, 'p') });
    await p.cycle(board('a'));
    await p.cycle(board());
    assert.deepEqual(brief(p), ['2 service_recovered n1:a suppressed', '1 service_down n1:a sent']);
    assert.deepEqual(history(p)[0].push, { state: 'suppressed', phones: 0, suppressed: 1 });

    const none = pushHalf(join(dir, 'other.json'), { fcm: fcmOn(), store: phones({}) });
    await none.cycle(board('b'));
    assert.deepEqual(brief(none), ['1 service_down n1:b unsent']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#267: a crash before the cycle\'s write: the restart diffs the change again and records it once', async () => {
  const { dir, path } = tmp();
  try {
    const p = pushHalf(path, { fcm: fcmOff(), write: writeSpy({ failOn: [2] }).write });
    await p.cycle(board());
    await p.cycle(board('a')); // diffed and recorded in memory; the write never lands: the process dies here
    assert.deepEqual(onDisk(path), board(), 'the file still has the last snapshot, and no history');

    const restarted = pushHalf(path, { fcm: fcmOff() });
    await restarted.cycle(board('a'));
    await restarted.cycle(board('a'));
    assert.deepEqual(brief(restarted), ['1 service_down n1:a off'], 'once: not lost, not doubled');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#267: a crash after the cycle\'s write, before the send: the restart sends it, records nothing again, and marks it sent', async () => {
  const { dir, path } = tmp();
  try {
    const hanging = { isPushEnabled: () => true, sendToToken: () => new Promise(() => {}) };
    const before = pushHalf(path, { fcm: hanging });
    await before.cycle(board());
    await runPushCycle({
      buildSnapshotFn: () => board('a'),
      store: phones({}, 'p'),
      fcm: hanging,
      snapshot: before.snapshot,
      sender: { wake() {} }, // the process dies before a send
      logger: silent,
    });

    const fcm = fcmOn();
    const after = pushHalf(path, { fcm });
    assert.deepEqual(brief(after), ['1 service_down n1:a queued']);
    await after.cycle(board('a'));
    assert.deepEqual(fcm.sent, ['p service_down n1:a']);
    assert.deepEqual(brief(after), ['1 service_down n1:a sent'], 'one record, now sent');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#267: a page and its recovery the outbox lets go unsent are both recorded, as dropped', async () => {
  const { dir, path } = tmp();
  try {
    const hanging = { isPushEnabled: () => true, sendToToken: () => new Promise(() => {}) };
    const p = pushHalf(path, { fcm: hanging });
    await p.cycle(board());
    // The sender is never woken: b's page waits, and b recovers before any phone took it.
    const cycle = (snap) =>
      runPushCycle({ buildSnapshotFn: () => snap, store: phones({}, 'p'), fcm: hanging, snapshot: p.snapshot, sender: { wake() {} }, logger: silent });
    await cycle(board('b'));
    await cycle(board());
    assert.deepEqual(brief(p), [
      '2 service_recovered n1:b dropped',
      '1 service_down n1:b dropped',
    ]);
    assert.deepEqual(p.snapshot.outbox(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#267: a file an older JagHelm wrote (no history) is read as before; the first event is id 1, and a file with no event ever has no history', async () => {
  const { dir, path } = tmp();
  try {
    writeFileSync(path, JSON.stringify(board()));
    const p = pushHalf(path, { fcm: fcmOff() });
    assert.deepEqual(p.snapshot.prev(), board());
    assert.deepEqual(history(p), []);
    await p.cycle(board('c'));
    assert.deepEqual(brief(p), ['1 service_down n1:c off']);
    assert.deepEqual(p.snapshot.prev(), board('c'), 'the history is not part of the snapshot');

    const quiet = pushHalf(join(dir, 'quiet.json'), { fcm: fcmOff() });
    await quiet.cycle(board());
    assert.deepEqual(onDisk(join(dir, 'quiet.json')), board(), 'no event: the file is as before #267');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#267: an unreadable file starts with no history and no snapshot, one warn that quotes nothing (#504), and keeps going', async () => {
  const { dir, path } = tmp();
  const lines = [];
  const logger = { ...silent, warn: (fields, msg) => lines.push({ fields, msg }) };
  try {
    writeFileSync(path, '{"history": {"events": [Hunter2-secret'); // pragma: allowlist secret
    const p = pushHalf(path, { fcm: fcmOff(), logger });
    assert.deepEqual(history(p), []);
    await p.cycle(board('a'));
    assert.deepEqual(brief(p), ['1 service_down n1:a off'], 'recording from scratch');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].msg, 'unreadable push snapshot, starting with no previous state');
    assert.doesNotMatch(JSON.stringify(lines), /Hunter2/);
    assert.ok(existsSync(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
