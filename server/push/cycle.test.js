import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runPushCycle } from './dispatch.js';

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
      snapshotPath: path,
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
      snapshotPath: path,
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
      snapshotPath: path,
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
        snapshotPath: path,
        thresholds: THRESHOLDS,
        logger: silentLog,
      })
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
