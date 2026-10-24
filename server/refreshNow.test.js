/**
 * refreshNow (#688) on the real module: it runs a whole cycle, leaves the
 * grid where it was (the phase-lock hint still points at the scheduled cycle),
 * and callers share cycles: a cycle that runs after a caller's change, never one per caller.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-refreshnow-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { refreshNow, startBackgroundRefresh, stopBackgroundRefresh, nextRefreshHintMs, getRefreshHealth } =
  await import('./refresh.js');

const { register } = await import('./metrics.js');

// Cycles run so far, by the loop's own histogram of cycle durations.
const cycles = async () => {
  const m = (await register.getMetricsAsJSON()).find((x) => x.name === 'jaghelm_refresh_cycle_duration_seconds');
  return m.values.find((v) => v.metricName.endsWith('_count'))?.value ?? 0;
};

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

const settle = async () => {
  for (let i = 0; i < 100 && getRefreshHealth().state === 'starting'; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise((r) => setTimeout(r, 100));
};

test('refreshNow runs a cycle without moving the grid; concurrent callers share one queued cycle', async () => {
  startBackgroundRefresh();
  await settle();

  const before = nextRefreshHintMs();
  const c0 = await cycles();
  assert.equal(await refreshNow(), true);
  assert.equal((await cycles()) - c0, 1, 'a whole cycle ran');
  const after1 = nextRefreshHintMs();
  assert.ok(after1 <= before, `the hint still counts down to the scheduled cycle (${before} -> ${after1}), not a fresh interval`);

  // Three at once.
  const c1 = await cycles();
  const results = await Promise.all([refreshNow(), refreshNow(), refreshNow()]);
  assert.deepEqual(results, [true, true, true]);
  assert.equal((await cycles()) - c1, 1, 'three callers at once, all before it starts: one cycle');

  // One arriving while that cycle runs needs one that starts after its own change.
  const c2 = await cycles();
  const a = refreshNow();
  await new Promise((r) => setTimeout(r, 0));
  const b = refreshNow();
  assert.notEqual(a, b);
  const c = refreshNow();
  assert.equal(b, c, 'and those arriving after share that one');
  assert.deepEqual(await Promise.all([a, b, c]), [true, true, true]);
  assert.equal((await cycles()) - c2, 2);

  // Callers arriving while one waits share it.
  const first = refreshNow();
  assert.equal(refreshNow(), first, 'the second joins the first');
  await first;
});
