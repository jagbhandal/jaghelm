/**
 * A hand edit of refreshInterval in display-config.json takes effect at the
 * loop's next tick, and /api/health judges staleness by the interval the timer
 * runs at, not the file's: lowering the interval by hand must not read as a
 * wedged loop (503) while the old, longer tick is still pending (#241).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-interval-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
// Refused ports: the warm-up cycle fails fast instead of waiting on a network.
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
const configPath = join(dataDir, 'display-config.json');
writeFileSync(configPath, JSON.stringify({ refreshInterval: 3600 }));

const { app } = await import('./index.js');
const { getRefreshHealth, startBackgroundRefresh, stopBackgroundRefresh } = await import('./refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

async function waitFor(check, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('a hand-lowered refreshInterval keeps /api/health ok and is followed at the next tick', async (t) => {
  // Record the loop's timers instead of letting them fire; the test runs ticks by hand.
  const timers = [];
  const realSetInterval = globalThis.setInterval;
  t.mock.method(globalThis, 'setInterval', (fn, ms) => {
    timers.push({ fn, ms });
    return realSetInterval(() => {}, 2 ** 31 - 1).unref();
  });

  startBackgroundRefresh();
  await waitFor(() => getRefreshHealth().state === 'ok'); // the warm-up cycle finished
  assert.equal(timers.at(-1).ms, 3_600_000);

  writeFileSync(configPath, JSON.stringify({ refreshInterval: 10 })); // hand edit
  // Two minutes on: stale for a 10 s loop (past 90 s), fine for the 1 h tick still pending.
  const base = Date.now();
  t.mock.method(Date, 'now', () => base + 120_000);
  const before = await request(app).get('/api/health');
  assert.equal(before.status, 200, 'judged by the interval the timer runs at');

  await timers.at(-1).fn(); // the pending tick
  assert.equal(timers.at(-1).ms, 10_000, 'the timer now runs at the edited interval');
  const afterTick = await request(app).get('/api/health');
  assert.equal(afterTick.status, 200);
  assert.equal(afterTick.body.refresh, 'ok');
});
