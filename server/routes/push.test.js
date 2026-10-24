/**
 * Push API route contract (auth-disabled harness). Drives the imported app with
 * supertest against an isolated temp data dir, mirroring server/index.test.js.
 * Push is disabled (no VAPID keys), the graceful-disable path.
 *
 * The Android app's routes (FCM registration, status and prefs) are gone with
 * the Firebase sender (#659): they answer 404 like any unknown route, and
 * nothing is stored. Settings → Notifications' routes are covered in
 * push.devices.test.js and webPush.test.js.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

// Before any server module loads: a static import would load the stores, and
// fix their path in the checkout's data/, before this line ran (#261).
const dataDir = mkdtempSync(join(tmpdir(), 'jh-push-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
delete process.env.VAPID_PUBLIC_KEY; // push disabled (no keys)
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

const PREFS = {
  categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
  notifyRecoveries: true,
  enabled: true,
};

test('the Android app’s routes answer 404 like any unknown route, and store nothing', async () => {
  const calls = [
    request(app).get('/api/push/status'),
    request(app).post('/api/push/register').send({ token: 'tok-aaa', platform: 'android', appVersion: '1.0.0' }),
    request(app).delete('/api/push/register').send({ token: 'tok-aaa' }),
    request(app).get('/api/push/prefs').query({ token: 'tok-aaa' }),
    request(app).put('/api/push/prefs').send({ token: 'tok-aaa', prefs: PREFS }),
  ];
  for (const call of await Promise.all(calls)) {
    assert.equal(call.status, 404, `${call.req.method} ${call.req.path}`);
  }
  const unknown = await request(app).get('/api/push/never-existed');
  assert.equal(unknown.status, 404, 'the same answer as a route that never existed');
  assert.equal(existsSync(join(dataDir, 'push-tokens.json')), false, 'no FCM token file is written');
  assert.equal(existsSync(join(dataDir, 'push-subscriptions.json')), false, 'nor a subscription');
});

test('GET /api/push/devices → push off, Web Push the only channel, no devices', async () => {
  const r = await request(app).get('/api/push/devices');
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false);
  assert.deepEqual(r.body.channels, { web: false });
  assert.deepEqual(r.body.devices, []);
  assert.deepEqual(r.body.defaults, PREFS);
  assert.equal(r.body.stalled, null);
});
