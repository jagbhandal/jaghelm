/**
 * Settings → Notifications' push routes (#320, #268): the registered phones
 * by fingerprint (never a token), removing one, and the test push, recorded
 * in GET /api/events like any push and limited to one per phone every 30 s.
 * The route factories over a real token store, snapshot and sender (temp
 * files); only FCM is faked. notifications.auth.test.js covers the 401s.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const dir = mkdtempSync(join(tmpdir(), 'jh-push-devices-'));
process.env.JAGHELM_DATA_DIR = dir;

const { createPushRoutes } = await import('./push.js');
const { createEventsRoutes } = await import('./events.js');
const { createPushSnapshot } = await import('../push/dispatch.js');
const { createPushSender } = await import('../push/outbox.js');
const { createTestPush } = await import('../push/testPush.js');
const { createTokenStore } = await import('../push/tokenStore.js');

after(() => rmSync(dir, { recursive: true, force: true }));

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const PIXEL_UA = 'Dalvik/2.1.0 (Linux; U; Android 15; Pixel 8 Build/AP3A.241005.015)';
const TOKEN_A = 'dGVzdC10b2tlbi1waXhlbDo5MXNlY3JldA'; // pragma: allowlist secret
const TOKEN_B = 'dGVzdC10b2tlbi10YWJsZXQ6c2VjcmV0'; // pragma: allowlist secret

let n = 0;
function app({ enabled = true } = {}) {
  n += 1;
  const store = createTokenStore({ path: join(dir, `tokens-${n}.json`) });
  const snapshot = createPushSnapshot({ path: join(dir, `snapshot-${n}.json`), logger: silent });
  const fcm = {
    sent: [],
    isPushEnabled: () => enabled,
    async sendToToken(token) {
      fcm.sent.push(token);
      return { ok: true, prune: false };
    },
  };
  let testPush;
  const sender = createPushSender({
    outbox: snapshot,
    store,
    fcm,
    logger: silent,
    onResult: (e, t, o) => testPush.onResult(e, t, o),
  });
  testPush = createTestPush({ snapshot, sender, store, fcm, logger: silent });
  const a = express();
  a.use(express.json());
  a.use('/api/push', createPushRoutes({ store, fcm, testPush, sender }));
  a.use('/api/events', createEventsRoutes({ history: snapshot }));
  return { a, store, fcm, sender };
}

async function register(a, token, ua) {
  const req = request(a).post('/api/push/register');
  if (ua) req.set('User-Agent', ua);
  const r = await req.send({ token, platform: 'android', appVersion: '1.3.0' });
  assert.equal(r.status, 200);
}

test('GET /api/push/devices: each phone by fingerprint, named from its User-Agent, and never its token', async () => {
  const { a } = app();
  await register(a, TOKEN_A, PIXEL_UA);
  await register(a, TOKEN_B, 'okhttp/4.12.0');
  const r = await request(a).get('/api/push/devices');
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.stalled, null);
  assert.equal(r.body.test, null);
  assert.equal(r.body.cooldownS, 30);
  assert.deepEqual(r.body.defaults.categories, {
    service: true,
    host: true,
    ups: true,
    cron: true,
    watchtower: true,
  });
  const [pixel, other] = r.body.devices;
  assert.deepEqual(
    [pixel.name, pixel.model, pixel.os, pixel.appVersion],
    ['Pixel 8', 'Pixel 8', '15', '1.3.0']
  );
  assert.equal(other.name, 'Android phone');
  assert.match(pixel.id, /^[0-9a-f]{12}$/);
  assert.match(pixel.registeredAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(pixel.lastDeliveredAt, null);
  assert.equal(pixel.lastError, null);
  assert.equal(pixel.prefs.enabled, true);
  // No token, nor any long piece of one, anywhere in the answer.
  const text = JSON.stringify(r.body);
  for (const token of [TOKEN_A, TOKEN_B]) {
    assert.ok(!text.includes(token.slice(0, 12)), 'no token in the device list');
  }
});

test('DELETE /api/push/devices/:id removes that phone; 404 for one there is not', async () => {
  const { a, store } = app();
  await register(a, TOKEN_A, PIXEL_UA);
  const [{ id }] = (await request(a).get('/api/push/devices')).body.devices;
  const r = await request(a).delete(`/api/push/devices/${id}`);
  assert.deepEqual([r.status, r.body], [200, { removed: true }]);
  assert.equal(store.getToken(TOKEN_A), null);
  assert.equal((await request(a).delete(`/api/push/devices/${id}`)).status, 404);
  assert.equal((await request(a).delete('/api/push/devices/__proto__')).status, 404);
});

test('POST /api/push/test: through the outbox, recorded in /api/events, then 429 within 30 s with Retry-After', async () => {
  const { a, fcm, sender } = app();
  await register(a, TOKEN_A, PIXEL_UA);
  const sent = await request(a).post('/api/push/test').send({});
  assert.equal(sent.status, 202);
  assert.equal(sent.body.device, null);
  await sender.idle();
  assert.deepEqual(fcm.sent, [TOKEN_A]);

  const { events } = (await request(a).get('/api/events')).body;
  assert.equal(events[0].id, sent.body.historyId);
  assert.deepEqual(
    [events[0].type, events[0].title, events[0].push.state, events[0].push.phones],
    ['push_test', 'JagHelm test push', 'sent', 1]
  );
  // The list shows the outcome and the phone's delivery.
  const list = (await request(a).get('/api/push/devices')).body;
  assert.equal(list.test.done, true);
  assert.match(list.test.sentence, /^Delivered/);
  assert.match(list.devices[0].lastDeliveredAt, /^\d{4}-/);

  const again = await request(a).post('/api/push/test').send({ device: list.devices[0].id });
  assert.equal(again.status, 429);
  assert.match(again.headers['retry-after'], /^\d+$/);
  assert.ok(again.body.retryAfterS > 0 && again.body.retryAfterS <= 30);
});

test('POST /api/push/test: 409 with push off, 404 for an unknown phone, 400 for a device that is no id', async () => {
  const off = app({ enabled: false });
  await register(off.a, TOKEN_A, PIXEL_UA);
  const r = await request(off.a).post('/api/push/test').send({});
  assert.deepEqual([r.status, r.body.code], [409, 'push_off']);
  assert.equal((await request(off.a).get('/api/push/devices')).body.enabled, false);

  const on = app();
  await register(on.a, TOKEN_A, PIXEL_UA);
  assert.equal(
    (await request(on.a).post('/api/push/test').send({ device: 'abcdefabcdef' })).status,
    404
  );
  assert.equal((await request(on.a).post('/api/push/test').send({ device: 7 })).status, 400);
  const none = app();
  assert.equal((await request(none.a).post('/api/push/test').send({})).status, 409);
  // Nothing recorded for a refused one.
  assert.deepEqual((await request(on.a).get('/api/events')).body.events, []);
  assert.ok(readFileSync(join(dir, `tokens-${n - 1}.json`), 'utf8').includes('Pixel 8'));
});
