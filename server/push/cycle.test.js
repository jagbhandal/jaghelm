import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createPushSnapshot, runPushCycle } from './dispatch.js';
import { createTokenStore } from './tokenStore.js';
import { atomicWriteFileSync } from '../util/atomicWrite.js';

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

// A minimal snapshot pair: baseline has a service up, next has it down.
const SNAP_UP = { services: { 'n1:svc': 'up' }, hosts: {}, ups: { state: 'online' }, cron: {} };
const SNAP_DOWN = { services: { 'n1:svc': 'down' }, hosts: {}, ups: { state: 'online' }, cron: {} };
const THRESHOLDS = { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 };

function tmpSnapshotPath() {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-push-'));
  return { dir, path: join(dir, 'snapshot.json') };
}

function enabledFcm() {
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

test('runPushCycle BASELINE: no prev file => persists snapshot, dispatches nothing', async () => {
  const { dir, path } = tmpSnapshotPath();
  const fcm = enabledFcm();
  try {
    await runPushCycle({
      buildSnapshotFn: () => SNAP_UP,
      store: oneTokenStore(),
      fcm,
      snapshot: createPushSnapshot({ path, logger: silentLog }),
      thresholds: THRESHOLDS,
      logger: silentLog,
    });
    assert.equal(fcm.calls.length, 0, 'no dispatch on baseline');
    assert.ok(existsSync(path), 'snapshot persisted so next cycle has a prev');
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), SNAP_UP);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle WITH PREV: diffs, dispatches the change, persists new snapshot', async () => {
  const { dir, path } = tmpSnapshotPath();
  writeFileSync(path, JSON.stringify(SNAP_UP)); // prev = service up
  const fcm = enabledFcm();
  try {
    await runPushCycle({
      buildSnapshotFn: () => SNAP_DOWN, // now down
      store: oneTokenStore(),
      fcm,
      snapshot: createPushSnapshot({ path, logger: silentLog }),
      thresholds: THRESHOLDS,
      logger: silentLog,
    });
    // up -> down => one service_down dispatched to the one token
    assert.equal(fcm.calls.length, 1);
    assert.equal(fcm.calls[0].type, 'service_down');
    // snapshot advanced to the new state
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), SNAP_DOWN);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle DISABLED: fcm.isPushEnabled false => no-op, no file write, no build', async () => {
  const { dir, path } = tmpSnapshotPath();
  let built = false;
  const fcm = { isPushEnabled: () => false, sendToToken: async () => ({ ok: true, prune: false }) };
  try {
    await runPushCycle({
      buildSnapshotFn: () => {
        built = true;
        return SNAP_UP;
      },
      store: oneTokenStore(),
      fcm,
      snapshot: createPushSnapshot({ path, logger: silentLog }),
      thresholds: THRESHOLDS,
      logger: silentLog,
    });
    assert.equal(built, false, 'snapshot not even built when push disabled');
    assert.equal(existsSync(path), false, 'no snapshot file written when disabled');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle ERROR ISOLATION: a throwing dep => resolves, never rejects', async () => {
  const { dir, path } = tmpSnapshotPath();
  const throwingFcm = {
    isPushEnabled: () => true,
    sendToToken: async () => {
      throw new Error('fcm exploded');
    },
  };
  try {
    // buildSnapshotFn itself throwing must also be swallowed.
    await assert.doesNotReject(
      runPushCycle({
        buildSnapshotFn: () => {
          throw new Error('snapshot build exploded');
        },
        store: oneTokenStore(),
        fcm: throwingFcm,
        snapshot: createPushSnapshot({ path, logger: silentLog }),
        thresholds: THRESHOLDS,
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
  const disabledFcm = { isPushEnabled: () => false, sendToToken: async () => ({ ok: true, prune: false }) };
  try {
    await runPushCycle({
      buildSnapshotFn: () => SNAP_UP,
      store: fakeStore,
      fcm: disabledFcm,
      snapshot: createPushSnapshot({ path, logger: silentLog }),
      thresholds: THRESHOLDS,
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
  const store = createTokenStore({ path: join(dir, 'push-tokens.json'), now: () => clock });
  store.registerToken('phone', { platform: 'android', appVersion: '1.0.0' }); // last app launch
  clock += 31 * DAY; // never opened since
  const fcm = enabledFcm();
  try {
    await runPushCycle({
      buildSnapshotFn: () => SNAP_DOWN,
      store,
      fcm,
      snapshot: createPushSnapshot({ path, logger: silentLog }),
      thresholds: THRESHOLDS,
      logger: silentLog,
    });
    assert.deepEqual(fcm.calls, [{ token: 'phone', type: 'service_down' }], 'the alert reached the phone');
    assert.equal(store.getToken('phone').lastSeenAt, clock, 'the accepted send bumped lastSeenAt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Write on change (#241) ────────────────────────────────────────────────

const host = (cpu) => ({
  services: { 'n1:svc': 'up' },
  hosts: { n1: { reachable: true, cpu, mem: 0.3, disk: 0.4 } },
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
function cycle(snapshot, snap, fcm, thresholds = THRESHOLDS) {
  return runPushCycle({
    buildSnapshotFn: () => snap,
    store: oneTokenStore(),
    fcm,
    snapshot,
    thresholds,
    logger: silentLog,
  });
}

test('runPushCycle steady state: an unchanged state is written once, then never', async () => {
  const { dir, path } = tmpSnapshotPath();
  const spy = writeSpy();
  const fcm = enabledFcm();
  try {
    const snapshot = createPushSnapshot({ path, write: spy.write, logger: silentLog });
    for (let i = 0; i < 5; i += 1) await cycle(snapshot, SNAP_UP, fcm);
    assert.equal(spy.attempts, 1, 'only the baseline is written');
    assert.equal(fcm.calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle: metrics moving on the same side of their threshold are not written', async () => {
  const { dir, path } = tmpSnapshotPath();
  const spy = writeSpy();
  const fcm = enabledFcm();
  try {
    const snapshot = createPushSnapshot({ path, write: spy.write, logger: silentLog });
    for (const cpu of [0.42, 0.47, 0.61, 0.89]) await cycle(snapshot, host(cpu), fcm);
    assert.equal(spy.attempts, 1, 'baseline only');
    await cycle(snapshot, host(0.95), fcm);
    assert.deepEqual(fcm.calls, [{ token: 'a', type: 'host_threshold' }]);
    assert.equal(spy.attempts, 2, 'crossing the threshold is written');
    assert.equal(spy.written[1].hosts.n1.cpu, 0.95);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle: the prev snapshot lives in memory; the file is read once', async () => {
  const { dir, path } = tmpSnapshotPath();
  const fcm = enabledFcm();
  try {
    const snapshot = createPushSnapshot({ path, logger: silentLog });
    await cycle(snapshot, SNAP_UP, fcm);
    writeFileSync(path, JSON.stringify(SNAP_DOWN)); // a later read would see "down"
    await cycle(snapshot, SNAP_UP, fcm);
    assert.equal(fcm.calls.length, 0, 'diffed against memory (up -> up), not the file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle restart: diffs against the last persisted state, no re-alert, no missed change', async () => {
  const { dir, path } = tmpSnapshotPath();
  const fcm = enabledFcm();
  try {
    const first = createPushSnapshot({ path, logger: silentLog });
    await cycle(first, SNAP_UP, fcm);
    await cycle(first, SNAP_DOWN, fcm);
    assert.deepEqual(fcm.calls.map((c) => c.type), ['service_down']);

    // Restart while still down: already alerted, so nothing is sent.
    await cycle(createPushSnapshot({ path, logger: silentLog }), SNAP_DOWN, fcm);
    assert.equal(fcm.calls.length, 1, 'no re-alert after a restart');

    // Restart after it recovered during the downtime: the recovery is sent.
    await cycle(createPushSnapshot({ path, logger: silentLog }), SNAP_UP, fcm);
    assert.deepEqual(fcm.calls.map((c) => c.type), ['service_down', 'service_recovered']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle restart: an older metric reading on disk does not raise a false alert', async () => {
  const { dir, path } = tmpSnapshotPath();
  const fcm = enabledFcm();
  try {
    const first = createPushSnapshot({ path, logger: silentLog });
    for (const cpu of [0.95, 0.97, 0.99]) await cycle(first, host(cpu), fcm); // high throughout
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).hosts.n1.cpu, 0.95, 'file kept the first high reading');
    await cycle(createPushSnapshot({ path, logger: silentLog }), host(0.98), fcm);
    assert.equal(fcm.calls.length, 0, 'still high after the restart: nothing new');
    await cycle(createPushSnapshot({ path, logger: silentLog }), host(0.2), fcm);
    assert.deepEqual(fcm.calls, [{ token: 'a', type: 'host_threshold_cleared' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle: a thresholds change rewrites the snapshot when a stored metric changes side', async () => {
  const { dir, path } = tmpSnapshotPath();
  const lower = { ...THRESHOLDS, cpu: 0.8 };
  const fcm = enabledFcm();
  try {
    const first = createPushSnapshot({ path, logger: silentLog });
    await cycle(first, host(0.5), fcm); // baseline written at 0.5
    await cycle(first, host(0.85), fcm); // below 0.9: not written
    await cycle(first, host(0.85), fcm, lower); // above the new 0.8: written
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).hosts.n1.cpu, 0.85);
    // Without the rewrite, a restart would diff 0.5 -> 0.85 and alert.
    await cycle(createPushSnapshot({ path, logger: silentLog }), host(0.85), fcm, lower);
    assert.equal(fcm.calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle: a failed write keeps memory moving and is retried until it lands', async () => {
  const { dir, path } = tmpSnapshotPath();
  const spy = writeSpy({ failOn: [2] });
  const fcm = enabledFcm();
  try {
    const snapshot = createPushSnapshot({ path, write: spy.write, logger: silentLog });
    await cycle(snapshot, SNAP_UP, fcm);
    await cycle(snapshot, SNAP_DOWN, fcm); // alert sent, write fails
    assert.deepEqual(fcm.calls.map((c) => c.type), ['service_down']);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), SNAP_UP, 'disk still behind');

    await cycle(snapshot, SNAP_DOWN, fcm);
    assert.equal(fcm.calls.length, 1, 'no repeat alert: memory moved on');
    assert.equal(spy.attempts, 3, 'the write was retried');
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), SNAP_DOWN, 'the retry landed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle: a restart before a failed write lands diffs against the older file, so the alert is sent again', async () => {
  const { dir, path } = tmpSnapshotPath();
  const spy = writeSpy({ failOn: [2] });
  try {
    const snapshot = createPushSnapshot({ path, write: spy.write, logger: silentLog });
    await cycle(snapshot, SNAP_UP, enabledFcm());
    await cycle(snapshot, SNAP_DOWN, enabledFcm()); // alert sent, write fails
    const afterRestart = enabledFcm();
    await cycle(createPushSnapshot({ path, logger: silentLog }), SNAP_DOWN, afterRestart);
    assert.deepEqual(afterRestart.calls.map((c) => c.type), ['service_down']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPushCycle: a dispatch that throws leaves prev alone, so the next cycle sends the alert', async () => {
  const { dir, path } = tmpSnapshotPath();
  let fail = true;
  const calls = [];
  const flakyFcm = {
    isPushEnabled: () => true,
    sendToToken: async (token, event) => {
      if (fail) throw new Error('fcm down');
      calls.push(event.type);
      return { ok: true, prune: false };
    },
  };
  try {
    const snapshot = createPushSnapshot({ path, logger: silentLog });
    await cycle(snapshot, SNAP_UP, flakyFcm);
    await cycle(snapshot, SNAP_DOWN, flakyFcm); // throws inside, swallowed
    fail = false;
    await cycle(snapshot, SNAP_DOWN, flakyFcm);
    assert.deepEqual(calls, ['service_down']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The file can lag memory by readings that stay on one side of their
// threshold. If the threshold is edited while JagHelm is stopped, a lagging
// reading can sit on the other side of the new one, so shutdown writes the
// latest snapshot (flush) and the restart diffs against the last reading, as
// it did when the file was written every cycle.
test('createPushSnapshot flush: a threshold lowered across a restart still raises the alert', async () => {
  const { dir, path } = tmpSnapshotPath();
  const lower = { ...THRESHOLDS, cpu: 0.8 };
  try {
    const first = createPushSnapshot({ path, logger: silentLog });
    for (const cpu of [0.85, 0.7, 0.6]) await cycle(first, host(cpu), enabledFcm()); // all below 0.9
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).hosts.n1.cpu, 0.85, 'the file lags memory');
    first.flush(); // shutdown
    const afterRestart = enabledFcm();
    await cycle(createPushSnapshot({ path, logger: silentLog }), host(0.82), afterRestart, lower);
    assert.deepEqual(afterRestart.calls.map((c) => c.type), ['host_threshold'], '0.60 -> 0.82 crosses 0.8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createPushSnapshot flush: a threshold lowered across a restart raises no alert the reading already passed', async () => {
  const { dir, path } = tmpSnapshotPath();
  const lower = { ...THRESHOLDS, cpu: 0.8 };
  try {
    const first = createPushSnapshot({ path, logger: silentLog });
    for (const cpu of [0.5, 0.85, 0.85]) await cycle(first, host(cpu), enabledFcm());
    first.flush();
    const afterRestart = enabledFcm();
    await cycle(createPushSnapshot({ path, logger: silentLog }), host(0.85), afterRestart, lower);
    assert.equal(afterRestart.calls.length, 0, '0.85 -> 0.85: no crossing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createPushSnapshot flush: writes nothing when the file is current or there is no snapshot', async () => {
  const { dir, path } = tmpSnapshotPath();
  const spy = writeSpy();
  try {
    const snapshot = createPushSnapshot({ path, write: spy.write, logger: silentLog });
    snapshot.flush();
    assert.equal(spy.attempts, 0, 'push never ran: nothing to write');
    await cycle(snapshot, SNAP_UP, enabledFcm());
    await cycle(snapshot, SNAP_UP, enabledFcm());
    snapshot.flush();
    assert.equal(spy.attempts, 1, 'only the baseline');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createPushSnapshot flush: a failed write is logged, not thrown', async () => {
  const { dir, path } = tmpSnapshotPath();
  const spy = writeSpy({ failOn: [2] });
  try {
    const snapshot = createPushSnapshot({ path, write: spy.write, logger: silentLog });
    await cycle(snapshot, host(0.5), enabledFcm());
    await cycle(snapshot, host(0.6), enabledFcm());
    assert.doesNotThrow(() => snapshot.flush());
    assert.equal(spy.attempts, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
