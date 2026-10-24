import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createPushSnapshot, runPushCycle } from './dispatch.js';
import { createPushSender } from './outbox.js';
import { createPhoneStore } from '../testing/phoneStore.js';
import { atomicWriteFileSync } from '../util/atomicWrite.js';

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * One push cycle, then the sends it queued (#579: the cycle itself sends
 * nothing). A send the push service fails waits for the next cycle's try.
 */
async function runCycle(deps) {
  let waits;
  const waiting = new Promise((resolve) => {
    waits = resolve;
  });
  const sleep = () => {
    waits();
    return new Promise(() => {});
  };
  const sender = createPushSender({ outbox: deps.snapshot, store: deps.store, channels: deps.channels, logger: silentLog, sleep });
  await runPushCycle({ ...deps, sender });
  await Promise.race([sender.idle(), waiting]);
}

// A minimal snapshot pair: a service up, then the same service down.
const SNAP_UP = { services: { 'n1:svc': 'up' }, hosts: {}, ups: { state: 'online' }, cron: {} };
const SNAP_DOWN = { services: { 'n1:svc': 'down' }, hosts: {}, ups: { state: 'online' }, cron: {} };

/** The snapshot the file holds, without the alert history beside it (#267). */
const filedSnapshot = (path) => ({ ...JSON.parse(readFileSync(path, 'utf8')), history: undefined });
const noHistory = (snap) => ({ ...snap, history: undefined });

function tmpSnapshotPath() {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-push-'));
  return { dir, path: join(dir, 'snapshot.json') };
}

function enabledChannels() {
  const calls = [];
  return {
    calls,
    isPushEnabled: () => true,
    sendToToken: async (token, event) => {
      calls.push({ token, type: event.type });
      return { ok: true, prune: false };
    },
  };
}

function oneTokenStore() {
  return {
    getAllTokens: () => [{ token: 'a' }],
    getPrefs: () => ({
      categories: { service: true, host: true, ups: true, cron: true },
      notifyRecoveries: true,
      enabled: true,
    }),
    removeToken: () => true,
    pruneStale: () => 0,
    markDelivered: () => 0,
  };
}

test('runPushCycle NO PREV: no prev file => diffs from no previous state; a healthy board dispatches nothing, and is persisted', async () => {
  const { dir, path } = tmpSnapshotPath();
  const channels = enabledChannels();
  try {
    await runCycle({
      buildSnapshotFn: () => SNAP_UP,
      store: oneTokenStore(),
      channels,
      snapshot: createPushSnapshot({ path, logger: silentLog }),
      logger: silentLog,
    });
    assert.equal(channels.calls.length, 0, 'nothing in trouble: nothing sent');
    assert.ok(existsSync(path), 'snapshot persisted so next cycle has a prev');
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), SNAP_UP);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle WITH PREV: diffs, dispatches the change, persists new snapshot', async () => {
  const { dir, path } = tmpSnapshotPath();
  writeFileSync(path, JSON.stringify(SNAP_UP)); // prev = service up
  const channels = enabledChannels();
  try {
    await runCycle({
      buildSnapshotFn: () => SNAP_DOWN, // now down
      store: oneTokenStore(),
      channels,
      snapshot: createPushSnapshot({ path, logger: silentLog }),
      logger: silentLog,
    });
    // up -> down => one service_down dispatched to the one token
    assert.equal(channels.calls.length, 1);
    assert.equal(channels.calls[0].type, 'service_down');
    // snapshot advanced to the new state
    assert.deepEqual(filedSnapshot(path), noHistory(SNAP_DOWN));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runPushCycle push off (#267): channels.isPushEnabled false => the change is recorded against the history's baseline; push's holds, nothing queued or sent, no sender woken", async () => {
  const { dir, path } = tmpSnapshotPath();
  writeFileSync(path, JSON.stringify(SNAP_UP)); // prev = service up
  let woken = 0;
  const channels = {
    isPushEnabled: () => false,
    sendToToken: async () => {
      throw new Error('push is off: nothing is sent');
    },
  };
  try {
    const snapshot = createPushSnapshot({ path, logger: silentLog });
    await runPushCycle({
      buildSnapshotFn: () => SNAP_DOWN,
      store: oneTokenStore(),
      channels,
      snapshot,
      sender: { wake: () => (woken += 1) },
      logger: silentLog,
    });
    assert.equal(woken, 0, 'the sender is not woken');
    assert.deepEqual(snapshot.outbox(), [], 'nothing queued');
    assert.deepEqual(filedSnapshot(path), noHistory(SNAP_UP), "push's snapshot holds, as before #267");
    assert.deepEqual(snapshot.historyPrev(), SNAP_DOWN, "the history's moved on");
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).history.snapshot, SNAP_DOWN, 'on disk too');
    assert.deepEqual(
      snapshot.events().events.map((e) => [e.type, e.key, e.push.state]),
      [['service_down', 'n1:svc', 'off']],
      'and the change is in the history'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle ERROR ISOLATION: a throwing dep => resolves, never rejects', async () => {
  const { dir, path } = tmpSnapshotPath();
  const throwingChannels = {
    isPushEnabled: () => true,
    sendToToken: async () => {
      throw new Error('channels exploded');
    },
  };
  try {
    // buildSnapshotFn itself throwing must also be swallowed.
    await assert.doesNotReject(
      runCycle({
        buildSnapshotFn: () => {
          throw new Error('snapshot build exploded');
        },
        store: oneTokenStore(),
        channels: throwingChannels,
        snapshot: createPushSnapshot({ path, logger: silentLog }),
          logger: silentLog,
      })
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle RETENTION: pruneStale called on every cycle, even when push is disabled', async () => {
  const { dir, path } = tmpSnapshotPath();
  let pruneCallCount = 0;
  const fakeStore = {
    ...oneTokenStore(),
    pruneStale: () => { pruneCallCount += 1; },
  };
  const disabledChannels = { isPushEnabled: () => false, sendToToken: async () => ({ ok: true, prune: false }) };
  try {
    await runCycle({
      buildSnapshotFn: () => SNAP_UP,
      store: fakeStore,
      channels: disabledChannels,
      snapshot: createPushSnapshot({ path, logger: silentLog }),
      logger: silentLog,
    });
    assert.equal(pruneCallCount, 1, 'pruneStale must be called once per cycle regardless of push-enabled state');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle #247: a phone not opened for 31 days still gets the alert, and the send keeps it alive', async () => {
  const { dir, path } = tmpSnapshotPath();
  writeFileSync(path, JSON.stringify(SNAP_UP)); // prev = service up
  const DAY = 24 * 60 * 60 * 1000;
  let clock = 1_000_000;
  const store = createPhoneStore({ now: () => clock });
  store.registerToken('phone', { platform: 'web' }); // last seen
  clock += 31 * DAY; // never opened since
  const channels = enabledChannels();
  try {
    await runCycle({
      buildSnapshotFn: () => SNAP_DOWN,
      store,
      channels,
      snapshot: createPushSnapshot({ path, logger: silentLog }),
      logger: silentLog,
    });
    assert.deepEqual(channels.calls, [{ token: 'phone', type: 'service_down' }], 'the alert reached the phone');
    assert.equal(store.getToken('phone').lastSeenAt, clock, 'the accepted send bumped lastSeenAt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Write on change (#241) ────────────────────────────────────────────────

// A snapshot whose host's CPU is at `cpu`, the level the model holds it at.
const host = (cpu) => ({
  services: { 'n1:svc': 'up' },
  hosts: { n1: { reachable: true, levels: { cpu, disk: 'ok', mem: 'ok' } } },
  ups: { state: 'online' },
  cron: {},
});

// Spies on the atomic writer: records every snapshot written, then really
// writes it (so a "restart" — a new createPushSnapshot on the same path —
// reads what was last persisted). Attempts listed in `failOn` throw instead.
function writeSpy({ failOn = [] } = {}) {
  const spy = {
    written: [],
    attempts: 0,
    write(path, data) {
      spy.attempts += 1;
      if (failOn.includes(spy.attempts)) throw new Error('disk full');
      spy.written.push(JSON.parse(data));
      atomicWriteFileSync(path, data);
    },
  };
  return spy;
}

// One push cycle against `snapshot`, with `snap` as this cycle's state.
function cycle(snapshot, snap, channels) {
  return runCycle({
    buildSnapshotFn: () => snap,
    store: oneTokenStore(),
    channels,
    snapshot,
    logger: silentLog,
  });
}

test('runPushCycle steady state: an unchanged state is written once, then never', async () => {
  const { dir, path } = tmpSnapshotPath();
  const spy = writeSpy();
  const channels = enabledChannels();
  try {
    const snapshot = createPushSnapshot({ path, write: spy.write, logger: silentLog });
    for (let i = 0; i < 5; i += 1) await cycle(snapshot, SNAP_UP, channels);
    assert.equal(spy.attempts, 1, 'only the baseline is written');
    assert.equal(channels.calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle: a level that holds is not written; a level that changes is (#292: no readings in the file)', async () => {
  const { dir, path } = tmpSnapshotPath();
  const spy = writeSpy();
  const channels = enabledChannels();
  try {
    const snapshot = createPushSnapshot({ path, write: spy.write, logger: silentLog });
    for (let i = 0; i < 4; i += 1) await cycle(snapshot, host('ok'), channels);
    assert.equal(spy.attempts, 1, 'baseline only');
    await cycle(snapshot, host('warn'), channels);
    assert.deepEqual(channels.calls, [{ token: 'a', type: 'host_threshold' }]);
    assert.equal(spy.attempts, 3, 'the new level is written with its page queued, then again once it is sent (#579)');
    assert.deepEqual(spy.written[1].hosts.n1, { reachable: true, levels: { cpu: 'warn', disk: 'ok', mem: 'ok' } });
    assert.deepEqual(spy.written[1].outbox.map((e) => e.event.type), ['host_threshold']);
    assert.deepEqual(noHistory(spy.written[2]), noHistory(host('warn')));
    await cycle(snapshot, host('warn'), channels);
    assert.equal(spy.attempts, 3, 'held: not written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle: the prev snapshot lives in memory; the file is read once', async () => {
  const { dir, path } = tmpSnapshotPath();
  const channels = enabledChannels();
  try {
    const snapshot = createPushSnapshot({ path, logger: silentLog });
    await cycle(snapshot, SNAP_UP, channels);
    writeFileSync(path, JSON.stringify(SNAP_DOWN)); // a later read would see "down"
    await cycle(snapshot, SNAP_UP, channels);
    assert.equal(channels.calls.length, 0, 'diffed against memory (up -> up), not the file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle restart: diffs against the last persisted state, no re-alert, no missed change', async () => {
  const { dir, path } = tmpSnapshotPath();
  const channels = enabledChannels();
  try {
    const first = createPushSnapshot({ path, logger: silentLog });
    await cycle(first, SNAP_UP, channels);
    await cycle(first, SNAP_DOWN, channels);
    assert.deepEqual(channels.calls.map((c) => c.type), ['service_down']);

    // Restart while still down: already alerted, so nothing is sent.
    await cycle(createPushSnapshot({ path, logger: silentLog }), SNAP_DOWN, channels);
    assert.equal(channels.calls.length, 1, 'no re-alert after a restart');

    // Restart after it recovered during the downtime: the recovery is sent.
    await cycle(createPushSnapshot({ path, logger: silentLog }), SNAP_UP, channels);
    assert.deepEqual(channels.calls.map((c) => c.type), ['service_down', 'service_recovered']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle: a failed write keeps memory moving and is retried until it lands', async () => {
  const { dir, path } = tmpSnapshotPath();
  // The cycle's write (the page queued) and the sender's (the page sent) both fail.
  const spy = writeSpy({ failOn: [2, 3] });
  const channels = enabledChannels();
  try {
    const snapshot = createPushSnapshot({ path, write: spy.write, logger: silentLog });
    await cycle(snapshot, SNAP_UP, channels);
    await cycle(snapshot, SNAP_DOWN, channels); // alert sent, writes fail
    assert.deepEqual(channels.calls.map((c) => c.type), ['service_down']);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), SNAP_UP, 'disk still behind');

    await cycle(snapshot, SNAP_DOWN, channels);
    assert.equal(channels.calls.length, 1, 'no repeat alert: memory moved on');
    assert.equal(spy.attempts, 4, 'the write was retried');
    assert.deepEqual(filedSnapshot(path), noHistory(SNAP_DOWN), 'the retry landed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle: a restart before a failed write lands diffs against the older file, so the alert is sent again', async () => {
  const { dir, path } = tmpSnapshotPath();
  const spy = writeSpy({ failOn: [2, 3] }); // queued, then sent: neither lands
  try {
    const snapshot = createPushSnapshot({ path, write: spy.write, logger: silentLog });
    await cycle(snapshot, SNAP_UP, enabledChannels());
    await cycle(snapshot, SNAP_DOWN, enabledChannels()); // alert sent, write fails
    const afterRestart = enabledChannels();
    await cycle(createPushSnapshot({ path, logger: silentLog }), SNAP_DOWN, afterRestart);
    assert.deepEqual(afterRestart.calls.map((c) => c.type), ['service_down']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #579: the snapshot moves on with the alert queued; the next try sends it, once.
test('runPushCycle: a send that throws keeps the alert queued, so the next try sends it', async () => {
  const { dir, path } = tmpSnapshotPath();
  let fail = true;
  const calls = [];
  const flakyChannels = {
    isPushEnabled: () => true,
    sendToToken: async (token, event) => {
      if (fail) throw new Error('channels down');
      calls.push(event.type);
      return { ok: true, prune: false };
    },
  };
  try {
    const snapshot = createPushSnapshot({ path, logger: silentLog });
    await cycle(snapshot, SNAP_UP, flakyChannels);
    await cycle(snapshot, SNAP_DOWN, flakyChannels); // throws inside, swallowed
    assert.deepEqual(snapshot.outbox().map((e) => e.type), ['service_down'], 'queued');
    assert.deepEqual(snapshot.prev(), SNAP_DOWN, 'and the snapshot moved on');
    fail = false;
    await cycle(snapshot, SNAP_DOWN, flakyChannels);
    await cycle(snapshot, SNAP_DOWN, flakyChannels);
    assert.deepEqual(calls, ['service_down']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A threshold edited while JagHelm is stopped, and a restart inside a
// hysteresis band, are the status model's to judge: push/hysteresis.test.js.
test('createPushSnapshot flush: writes nothing when the file is current or there is no snapshot', async () => {
  const { dir, path } = tmpSnapshotPath();
  const spy = writeSpy();
  try {
    const snapshot = createPushSnapshot({ path, write: spy.write, logger: silentLog });
    snapshot.flush();
    assert.equal(spy.attempts, 0, 'push never ran: nothing to write');
    await cycle(snapshot, SNAP_UP, enabledChannels());
    await cycle(snapshot, SNAP_UP, enabledChannels());
    snapshot.flush();
    assert.equal(spy.attempts, 1, 'only the baseline');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createPushSnapshot flush: writes the file if a failed write left it behind; a failed write is logged, not thrown', async () => {
  const { dir, path } = tmpSnapshotPath();
  const spy = writeSpy({ failOn: [2, 3, 4] });
  try {
    const snapshot = createPushSnapshot({ path, write: spy.write, logger: silentLog });
    await cycle(snapshot, host('ok'), enabledChannels());
    await cycle(snapshot, host('warn'), enabledChannels()); // the writes fail: the file is behind
    assert.doesNotThrow(() => snapshot.flush()); // and so does this one
    assert.equal(spy.attempts, 4);
    snapshot.flush();
    assert.equal(spy.attempts, 5, 'a later flush writes it');
    assert.deepEqual(filedSnapshot(path), noHistory(host('warn')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #232: the builder is handed the previous snapshot, so it can keep the parts a
// failed source feeds; advancing to what it returns keeps them across cycles.
test('runPushCycle hands buildSnapshotFn the previous snapshot (null when there is none)', async () => {
  const { dir, path } = tmpSnapshotPath();
  const seen = [];
  const build = (prev) => {
    seen.push(prev);
    return SNAP_UP;
  };
  try {
    const snapshot = createPushSnapshot({ path, logger: silentLog });
    for (let i = 0; i < 2; i += 1) {
      await runCycle({
        buildSnapshotFn: build,
        store: oneTokenStore(),
        channels: enabledChannels(),
        snapshot,
          logger: silentLog,
      });
    }
    assert.deepEqual(seen, [null, SNAP_UP]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #448: with no previous snapshot every entity is new, so what is in trouble
// pages once, on that cycle, and not again.
test('runPushCycle NO PREV: what is in trouble pages once, and the next cycle diffs against it', async () => {
  const { dir, path } = tmpSnapshotPath();
  const channels = enabledChannels();
  try {
    const snapshot = createPushSnapshot({ path, logger: silentLog });
    for (let i = 0; i < 3; i += 1) {
      await runCycle({
        buildSnapshotFn: () => SNAP_DOWN,
        store: oneTokenStore(),
        channels,
        snapshot,
        logger: silentLog,
      });
    }
    assert.deepEqual(channels.calls, [{ token: 'a', type: 'service_down' }]);
    assert.deepEqual(filedSnapshot(path), noHistory(SNAP_DOWN));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #232 review: a builder with no snapshot to give (no previous one while a
// source fails) returns null, and the cycle neither sends nor advances.
test('runPushCycle: a null snapshot skips the cycle, so the first snapshot waits for one', async () => {
  const { dir, path } = tmpSnapshotPath();
  const channels = enabledChannels();
  const snapshot = createPushSnapshot({ path, logger: silentLog });
  const cycle = (build) =>
    runCycle({
      buildSnapshotFn: build,
      store: oneTokenStore(),
      channels,
      snapshot,
      logger: silentLog,
    });
  try {
    await cycle(() => null);
    assert.equal(snapshot.prev(), null, 'no snapshot taken');
    assert.equal(existsSync(path), false, 'nothing written');

    await cycle(() => SNAP_DOWN); // the first snapshot: the service is down (#448)
    await cycle(() => null); // skipped: prev stays the first snapshot
    await cycle(() => SNAP_UP);
    assert.deepEqual(channels.calls, [
      { token: 'a', type: 'service_down' },
      { token: 'a', type: 'service_recovered' },
    ]);
    assert.deepEqual(snapshot.prev(), SNAP_UP);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
