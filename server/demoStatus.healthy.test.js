/**
 * The demo's /api/status for `healthy` is what the live loop builds for that
 * board at the same two clocks (#437, #442; testing/demoLiveStatus.js). Its own
 * file, so the loop's tracker starts from a fresh boot's, as the demo's does,
 * not from the incident board's memory (demoStatus.test.js has `incident`).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { isDemoMode, liveStatusOf, served, stopBackgroundRefresh } =
  await import('./testing/demoLiveStatus.js');

after(() => stopBackgroundRefresh());

test('demo /api/status: healthy: the same as the live loop builds for that board (#437)', () => {
  assert.equal(isDemoMode(), false, 'the live side runs outside demo mode');
  const live = liveStatusOf('healthy');
  const demo = served('/api/status', 'healthy');

  assert.deepEqual(demo, live);
  assert.deepEqual(live.overall, { state: 'ok', sentence: 'All 12 services up · 3 nodes healthy' });
  assert.deepEqual(live.issues, []);
});
