import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runPushCycle } from './dispatch.js';

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

// Mirror the refresh-loop body shape: allSettled of domain refreshes, then
// an awaited runPushCycle, then recordRefreshCycle in finally. Prove that a
// push cycle whose every dep throws leaves `ok` true and the loop intact.
test('refresh-loop shape: a throwing push cycle keeps the cycle ok and reaches finally', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-refresh-'));
  const path = join(dir, 'snapshot.json');
  let recorded = null;
  const recordRefreshCycle = (ms, ok) => {
    recorded = { ms, ok };
  };

  const throwingFcm = {
    isPushEnabled: () => true,
    sendToToken: async () => {
      throw new Error('boom');
    },
  };
  const store = {
    getAllTokens: () => [{ token: 'a' }],
    getPrefs: () => ({ categories: { service: true, host: true, ups: true, cron: true }, notifyRecoveries: true, enabled: true }),
    removeToken: () => true,
  };

  // The actual loop body, transcribed.
  const start = Date.now();
  let ok = true;
  try {
    await Promise.allSettled([Promise.resolve('services'), Promise.resolve('ups')]);
    await runPushCycle({
      buildSnapshotFn: () => {
        throw new Error('snapshot boom');
      },
      store,
      fcm: throwingFcm,
      snapshotPath: path,
      thresholds: { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 },
      logger: silentLog,
    });
  } catch (err) {
    ok = false; // must NOT happen — runPushCycle swallows
  } finally {
    recordRefreshCycle(Date.now() - start, ok);
  }

  assert.equal(ok, true, 'throwing push cycle did not flip the cycle to failed');
  assert.ok(recorded, 'finally still ran recordRefreshCycle');
  assert.equal(recorded.ok, true);

  rmSync(dir, { recursive: true, force: true });
});
