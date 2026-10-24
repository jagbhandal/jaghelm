/**
 * Web Push routes (#653) over the real stores, snapshot, outbox and sender (temp
 * files); only the push service is faked (the sender's fetch). Everything the
 * run writes to stdout and stderr is captured and searched for the endpoint and
 * the keys, which must be nowhere in a response or a log line.
 */
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import request from 'supertest';

const dir = mkdtempSync(join(tmpdir(), 'jh-webpush-'));
process.env.JAGHELM_DATA_DIR = dir;

const { createPushRoutes } = await import('./push.js');
const { createWebPushRoutes } = await import('./webPush.js');
const { createPushSnapshot } = await import('../push/dispatch.js');
const { createPushSender } = await import('../push/outbox.js');
const { createTestPush } = await import('../push/testPush.js');
const { createWebPushStore } = await import('../push/webPushStore.js');
const { createChannels } = await import('../push/channels.js');
const { createWebPushSender, readVapid } = await import('../push/webPush.js');
const { generateVapidKeys } = await import('../push/webPushCrypto.js');

after(() => rmSync(dir, { recursive: true, force: true }));

// ── capture every log line the process writes (the logger's JSON lines; the
// test runner's own output passes through) ───────────────────────────────────
let captured = '';
const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);
const tap = (real) => (chunk, ...rest) => {
  if (typeof chunk === 'string' && chunk.startsWith('{"time":')) {
    captured += chunk;
    return true;
  }
  return real(chunk, ...rest);
};
before(() => {
  process.stdout.write = tap(realOut);
  process.stderr.write = tap(realErr);
});
after(() => {
  process.stdout.write = realOut;
  process.stderr.write = realErr;
});

const SECRET = 'ENDPOINT-SECRET-PATH-653'; // pragma: allowlist secret
const endpoint = (n = 'a') => `https://fcm.googleapis.com/fcm/send/${SECRET}-${n}`;
const browserKeys = () => ({
  p256dh: generateVapidKeys().publicKey,
  auth: randomBytes(16).toString('base64url'),
});
const vapidPair = generateVapidKeys();
const vapid = readVapid({
  VAPID_PUBLIC_KEY: vapidPair.publicKey,
  VAPID_PRIVATE_KEY: vapidPair.privateKey,
  VAPID_SUBJECT: 'mailto:ops@example.net',
});
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

let n = 0;
/** `answer`: the push service's status, or a list of them, one per post, the last repeating. */
function harness({ answer = 201, enabled = true, clock = { t: 1_800_000_000_000 } } = {}) {
  n += 1;
  const webStore = createWebPushStore({ path: join(dir, `subs-${n}.json`) });
  const store = webStore;
  const snapshot = createPushSnapshot({ path: join(dir, `snapshot-${n}.json`), logger: quiet });
  const posts = [];
  const state = { answers: [].concat(answer) };
  const web = createWebPushSender({
    vapid: enabled ? vapid : { enabled: false, reason: 'unset' },
    store: webStore,
    fetchImpl: async (url, init) => {
      posts.push({ url, init });
      const status = state.answers.length > 1 ? state.answers.shift() : state.answers[0];
      return new Response(null, { status });
    },
    now: () => clock.t,
  });
  const channels = createChannels(() => web);
  let testPush;
  const sender = createPushSender({
    outbox: snapshot,
    store,
    channels,
    // The sender's wait is the test clock moving on.
    sleep: async (ms) => {
      clock.t += ms;
    },
    now: () => clock.t,
    onResult: (e, t, o) => testPush.onResult(e, t, o),
  });
  testPush = createTestPush({ snapshot, sender, store, channels, now: () => clock.t });
  const status = () => (enabled ? { enabled: true, publicKey: vapid.publicKey } : { enabled: false, reason: 'unset' });
  const a = express();
  a.use(express.json());
  a.use('/api/push/web', createWebPushRoutes({ webStore, status, testPush }));
  a.use('/api/push', createPushRoutes({ store, testPush, sender, channels }));
  return { a, webStore, posts, state, sender, clock, store };
}

test('GET /key serves the public key, never the private one, uncached', async () => {
  const { a } = harness();
  const r = await request(a).get('/api/push/web/key');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { enabled: true, publicKey: vapid.publicKey });
  assert.match(r.headers['cache-control'], /no-store/);
  assert.ok(!JSON.stringify(r.body).includes(vapidPair.privateKey));
});

test('GET /key says why Web Push is off', async () => {
  const { a } = harness({ enabled: false });
  const r = await request(a).get('/api/push/web/key');
  assert.deepEqual(r.body, { enabled: false, reason: 'unset' });
});

test('POST /subscriptions registers (201), refreshes idempotently (200), and lists without the endpoint or keys', async () => {
  const { a } = harness();
  const sub = { endpoint: endpoint(), keys: browserKeys() };
  const first = await request(a).post('/api/push/web/subscriptions').send({ subscription: sub, name: 'Pixel 8' });
  assert.equal(first.status, 201);
  assert.match(first.body.id, /^[0-9a-f]{12}$/);
  assert.equal(first.body.name, 'Pixel 8');
  const again = await request(a).post('/api/push/web/subscriptions').send({ subscription: sub, name: 'Pixel 8b' });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id);
  const list = await request(a).get('/api/push/web/subscriptions');
  assert.equal(list.body.subscriptions.length, 1);
  assert.deepEqual(Object.keys(list.body.subscriptions[0]).sort(), ['createdAt', 'id', 'lastSeen', 'name']);
  assert.equal(list.body.subscriptions[0].name, 'Pixel 8b');
  for (const res of [first, again, list]) {
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(SECRET) && !text.includes('googleapis') && !text.includes(sub.keys.p256dh) && !text.includes(sub.keys.auth));
  }
});

test('POST /subscriptions validates: shape, endpoint host and scheme, keys, name, size', async () => {
  const { a } = harness();
  const keys = browserKeys();
  const bad = [
    {},
    { subscription: 'x' },
    { subscription: [] },
    { subscription: { endpoint: endpoint() } },
    { subscription: { endpoint: endpoint(), keys: { p256dh: keys.p256dh } } },
    { subscription: { endpoint: endpoint(), keys: { p256dh: 'AAAA', auth: keys.auth } } },
    { subscription: { endpoint: endpoint(), keys }, name: 5 },
    { subscription: { endpoint: 'http://fcm.googleapis.com/fcm/send/x', keys } },
    { subscription: { endpoint: 'https://192.168.68.11/x', keys } },
    { subscription: { endpoint: 'https://localhost/x', keys } },
    { subscription: { endpoint: 'https://user:pw@fcm.googleapis.com/x', keys } },
    { subscription: { endpoint: 'https://evil.example/fcm/send/x', keys } },
    { subscription: { endpoint: `https://fcm.googleapis.com/${'a'.repeat(5000)}`, keys } },
  ];
  for (const body of bad) {
    const r = await request(a).post('/api/push/web/subscriptions').send(body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 100));
    assert.ok(!JSON.stringify(r.body).includes('192.168'), 'the error does not echo the input');
    assert.ok(!JSON.stringify(r.body).includes('evil.example'));
  }
  assert.equal((await request(a).get('/api/push/web/subscriptions')).body.subscriptions.length, 0);
});

test('POST /subscriptions is refused (409) while Web Push is off, and past 20 browsers', async () => {
  const off = harness({ enabled: false });
  const r = await request(off.a).post('/api/push/web/subscriptions').send({ subscription: { endpoint: endpoint(), keys: browserKeys() } });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /VAPID/);

  const { a } = harness();
  for (let i = 0; i < 20; i += 1) {
    const ok = await request(a).post('/api/push/web/subscriptions').send({ subscription: { endpoint: endpoint(`n${i}`), keys: browserKeys() } });
    assert.equal(ok.status, 201);
  }
  const over = await request(a).post('/api/push/web/subscriptions').send({ subscription: { endpoint: endpoint('n21'), keys: browserKeys() } });
  assert.equal(over.status, 409);
});

test('DELETE /subscriptions/:id removes it; an unknown id is 404', async () => {
  const { a, webStore } = harness();
  const { body } = await request(a).post('/api/push/web/subscriptions').send({ subscription: { endpoint: endpoint('d'), keys: browserKeys() } });
  assert.equal((await request(a).delete(`/api/push/web/subscriptions/${body.id}`)).status, 200);
  assert.equal(webStore.list().length, 0);
  assert.equal((await request(a).delete(`/api/push/web/subscriptions/${body.id}`)).status, 404);
  assert.equal((await request(a).delete('/api/push/web/subscriptions/not-an-id')).status, 404);
});

test('POST /test sends through the outbox: it arrives, is followed in GET /devices, and leaks nothing', async () => {
  const { a, posts, sender } = harness();
  const { body } = await request(a).post('/api/push/web/subscriptions').send({ subscription: { endpoint: endpoint('t'), keys: browserKeys() }, name: 'Pixel' });
  const t = await request(a).post('/api/push/web/test').send({ id: body.id });
  assert.equal(t.status, 202);
  await sender.idle();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].init.headers.Urgency, 'high');
  const devices = await request(a).get('/api/push/devices');
  assert.equal(devices.body.enabled, true);
  assert.deepEqual(devices.body.channels, { web: true });
  assert.equal(devices.body.devices.length, 1);
  assert.equal(devices.body.devices[0].id, body.id);
  assert.equal(devices.body.devices[0].name, 'Pixel');
  assert.equal(devices.body.test.done, true);
  assert.match(devices.body.test.sentence, /Delivered/);
  const text = JSON.stringify([t.body, devices.body]);
  assert.ok(!text.includes(SECRET) && !text.includes('googleapis.com/fcm'));
});

test('POST /test: 400 without an id, 404 for an unknown one, 429 within 30 s', async () => {
  const { a, clock } = harness();
  assert.equal((await request(a).post('/api/push/web/test').send({})).status, 400);
  assert.equal((await request(a).post('/api/push/web/test').send({ id: 5 })).status, 400);
  const { body } = await request(a).post('/api/push/web/subscriptions').send({ subscription: { endpoint: endpoint('c'), keys: browserKeys() } });
  assert.equal((await request(a).post('/api/push/web/test').send({ id: 'ffffffffffff' })).status, 404);
  assert.equal((await request(a).post('/api/push/web/test').send({ id: body.id })).status, 202);
  const again = await request(a).post('/api/push/web/test').send({ id: body.id });
  assert.equal(again.status, 429);
  assert.ok(again.headers['retry-after']);
  clock.t += 31_000;
  assert.equal((await request(a).post('/api/push/web/test').send({ id: body.id })).status, 202);
});

test('a 410 from the push service removes that subscription; the device list shows it gone', async () => {
  const { a, sender, webStore } = harness({ answer: 410 });
  const { body } = await request(a).post('/api/push/web/subscriptions').send({ subscription: { endpoint: endpoint('g'), keys: browserKeys() } });
  await request(a).post('/api/push/web/test').send({ id: body.id });
  await sender.idle();
  assert.equal(webStore.list().length, 0, 'pruned');
  const devices = await request(a).get('/api/push/devices');
  assert.equal(devices.body.devices.length, 0);
});

test('a 500 keeps the subscription and the outbox sends it again after its wait; a 403 is not retried', async () => {
  const flaky = harness({ answer: [500, 201] });
  const { body } = await request(flaky.a).post('/api/push/web/subscriptions').send({ subscription: { endpoint: endpoint('f'), keys: browserKeys() } });
  await request(flaky.a).post('/api/push/web/test').send({ id: body.id });
  await flaky.sender.idle();
  assert.equal(flaky.posts.length, 2, 'tried again');
  assert.equal(flaky.webStore.list().length, 1, 'kept');
  const dev = (await request(flaky.a).get('/api/push/devices')).body.devices[0];
  assert.equal(dev.lastError, null, 'the delivery cleared the failure');
  assert.ok(dev.lastDeliveredAt);

  const refused = harness({ answer: 403 });
  const r2 = await request(refused.a).post('/api/push/web/subscriptions').send({ subscription: { endpoint: endpoint('h'), keys: browserKeys() } });
  await request(refused.a).post('/api/push/web/test').send({ id: r2.body.id });
  await refused.sender.idle();
  assert.equal(refused.posts.length, 1, 'sent once, not retried');
  assert.equal(refused.webStore.list().length, 1, 'kept');
});

test('the retired FCM registration route answers 404 for a wp: token too, and the device list removes a web subscription by id', async () => {
  const { a, webStore } = harness();
  assert.equal((await request(a).post('/api/push/register').send({ token: 'wp:aaaaaaaaaaaa' })).status, 404);
  const { body } = await request(a).post('/api/push/web/subscriptions').send({ subscription: { endpoint: endpoint('r'), keys: browserKeys() } });
  assert.equal((await request(a).delete(`/api/push/devices/${body.id}`)).status, 200);
  assert.equal(webStore.list().length, 0);
});

test('nothing this file did put an endpoint, its path or a key in a log line or the console', () => {
  assert.ok(captured.length > 0, 'the run did log (the check is not vacuous)');
  assert.ok(!captured.includes(SECRET), 'endpoint path in the log');
  assert.ok(!captured.includes('fcm.googleapis.com/fcm'), 'endpoint in the log');
  assert.ok(!captured.includes(vapidPair.privateKey), 'private key in the log');
});

test('registering again without a name keeps the name it has', async () => {
  const { a } = harness();
  const sub = { endpoint: endpoint('nm'), keys: browserKeys() };
  await request(a).post('/api/push/web/subscriptions').send({ subscription: sub, name: 'Kitchen tablet' });
  const again = await request(a).post('/api/push/web/subscriptions').send({ subscription: sub });
  assert.equal(again.status, 200);
  assert.equal(again.body.name, 'Kitchen tablet');
  assert.equal((await request(a).get('/api/push/web/subscriptions')).body.subscriptions[0].name, 'Kitchen tablet');
});
