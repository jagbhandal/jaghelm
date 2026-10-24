/**
 * Settings → Notifications' push routes (#320, #268): the registered browsers
 * by fingerprint (never a token or endpoint), removing one, and the test push, recorded
 * in GET /api/events like any push and limited to one per phone every 30 s.
 * The route factories over a real Web Push store, snapshot and sender (temp
 * files); only the channel is faked. notifications.auth.test.js covers the 401s.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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
const { createWebPushStore } = await import('../push/webPushStore.js');
const { generateVapidKeys } = await import('../push/webPushCrypto.js');

after(() => rmSync(dir, { recursive: true, force: true }));

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const SECRET_A = 'PIXEL-ENDPOINT-SECRET';
const SECRET_B = 'TABLET-ENDPOINT-SECRET';
/** A browser's subscription, as its page posts it. */
const subscription = (secret, name) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${secret}`,
  p256dh: generateVapidKeys().publicKey,
  auth: randomBytes(16).toString('base64url'),
  name,
});

let n = 0;
let clock = 1_800_000_000_000;
function app({ enabled = true } = {}) {
  n += 1;
  const store = createWebPushStore({ path: join(dir, `subscriptions-${n}.json`), now: () => (clock += 1000) });
  const snapshot = createPushSnapshot({ path: join(dir, `snapshot-${n}.json`), logger: silent });
  const channels = {
    sent: [],
    isPushEnabled: () => enabled,
    status: () => ({ web: enabled }),
    async sendToToken(token) {
      channels.sent.push(token);
      return { ok: true, prune: false };
    },
  };
  let testPush;
  const sender = createPushSender({
    outbox: snapshot,
    store,
    channels,
    logger: silent,
    onResult: (e, t, o) => testPush.onResult(e, t, o),
  });
  testPush = createTestPush({ snapshot, sender, store, channels, logger: silent });
  const a = express();
  a.use(express.json());
  a.use('/api/push', createPushRoutes({ store, channels, testPush, sender }));
  a.use('/api/events', createEventsRoutes({ history: snapshot }));
  return { a, store, channels, sender };
}

/** Turn alerts on in a browser: its subscription in the store. Returns its pseudo token. */
function register(store, secret, name) {
  const r = store.register(subscription(secret, name));
  assert.equal(r.ok, true);
  return `wp:${r.id}`;
}

test('GET /api/push/devices: each browser by fingerprint, named as it named itself, and never its token or endpoint', async () => {
  const { a, store } = app();
  register(store, SECRET_A, 'Pixel 8 (Chrome)');
  register(store, SECRET_B);
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
  assert.deepEqual(r.body.channels, { web: true });
  const [pixel, other] = r.body.devices;
  assert.deepEqual([pixel.name, pixel.platform], ['Pixel 8 (Chrome)', 'web']);
  assert.equal(other.name, 'Web browser');
  assert.equal('appVersion' in pixel || 'os' in pixel || 'model' in pixel, false, 'nothing of the retired app');
  assert.match(pixel.id, /^[0-9a-f]{12}$/);
  assert.match(pixel.registeredAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(pixel.lastDeliveredAt, null);
  assert.equal(pixel.lastError, null);
  assert.equal(pixel.prefs.enabled, true);
  // No token, nor any long piece of one, anywhere in the answer.
  const text = JSON.stringify(r.body);
  for (const secret of [SECRET_A, SECRET_B, 'googleapis', 'p256dh']) {
    assert.ok(!text.includes(secret), `no ${secret} in the device list`);
  }
});

test('DELETE /api/push/devices/:id removes that phone; 404 for one there is not', async () => {
  const { a, store } = app();
  const token = register(store, SECRET_A, 'Pixel 8 (Chrome)');
  const [{ id }] = (await request(a).get('/api/push/devices')).body.devices;
  const r = await request(a).delete(`/api/push/devices/${id}`);
  assert.deepEqual([r.status, r.body], [200, { removed: true }]);
  assert.equal(store.getPrefs(token).enabled, true);
  assert.deepEqual(store.getAllTokens(), []);
  assert.equal((await request(a).delete(`/api/push/devices/${id}`)).status, 404);
  assert.equal((await request(a).delete('/api/push/devices/__proto__')).status, 404);
});

test('POST /api/push/test: through the outbox, recorded in /api/events, then 429 within 30 s with Retry-After', async () => {
  const { a, store, channels, sender } = app();
  const token = register(store, SECRET_A, 'Pixel 8 (Chrome)');
  const sent = await request(a).post('/api/push/test').send({});
  assert.equal(sent.status, 202);
  assert.equal(sent.body.device, null);
  await sender.idle();
  assert.deepEqual(channels.sent, [token]);

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
  register(off.store, SECRET_A, 'Pixel 8 (Chrome)');
  const r = await request(off.a).post('/api/push/test').send({});
  assert.deepEqual([r.status, r.body.code], [409, 'push_off']);
  assert.equal((await request(off.a).get('/api/push/devices')).body.enabled, false);

  const on = app();
  register(on.store, SECRET_A, 'Pixel 8 (Chrome)');
  assert.equal(
    (await request(on.a).post('/api/push/test').send({ device: 'abcdefabcdef' })).status,
    404
  );
  assert.equal((await request(on.a).post('/api/push/test').send({ device: 7 })).status, 400);
  const none = app();
  assert.equal((await request(none.a).post('/api/push/test').send({})).status, 409);
  // Nothing recorded for a refused one.
  assert.deepEqual((await request(on.a).get('/api/events')).body.events, []);
  assert.ok(readFileSync(join(dir, `subscriptions-${n - 1}.json`), 'utf8').includes('Pixel 8 (Chrome)'));
});
