/**
 * #669: the notification buttons' route (proven by the browser's own
 * subscription endpoint, not the session) and Settings' view of what is
 * snoozed or held; and the alert history's known-cause tag.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const dir = mkdtempSync(join(tmpdir(), 'jh-alerts-'));
process.env.JAGHELM_DATA_DIR = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { createAlertActionRoute, createAlertsRoutes } = await import('./pushAlerts.js');
const { createEventsRoutes } = await import('./events.js');
const { createAlertState } = await import('../push/alertState.js');
const { createAlertPolicy } = await import('../push/alertPolicy.js');
const { resolveAlerts } = await import('../push/alertRules.js');
const { createWebPushStore } = await import('../push/webPushStore.js');
const { generateVapidKeys } = await import('../push/webPushCrypto.js');
const { randomBytes } = await import('node:crypto');

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
const silent = { info() {}, warn() {}, debug() {}, error() {} };

function setup() {
  const clock = { now: 1_000_000 };
  const webStore = createWebPushStore({
    path: join(dir, `subs-${Math.random()}.json`),
    logger: silent,
  });
  const { publicKey } = generateVapidKeys();
  webStore.register({
    endpoint: ENDPOINT,
    p256dh: publicKey,
    auth: randomBytes(16).toString('base64url'),
    name: 'Pixel',
  });
  let saves = 0;
  const state = createAlertState({ save: () => (saves += 1), now: () => clock.now });
  const policy = createAlertPolicy({ rules: () => resolveAlerts({}), state, now: () => clock.now });
  const app = express();
  app.use(express.json());
  app.use(
    '/action',
    createAlertActionRoute({ webStore, policy, now: () => clock.now, logger: silent })
  );
  app.use('/alerts', createAlertsRoutes({ policy, entries: () => [] }));
  return { app, state, clock, saves: () => saves };
}

test('Ack and Snooze from a notification are proven by the subscription endpoint alone', async () => {
  const { app, state, saves } = setup();
  state.observe('services/n1:a', false);
  const unknown = await request(app)
    .post('/action')
    .send({ endpoint: `${ENDPOINT}x`, action: 'ack', keys: ['services/n1:a'] });
  assert.equal(unknown.status, 404);
  assert.equal(
    state.suppression('services/n1:a', false),
    null,
    'an unknown endpoint changes nothing'
  );
  assert.equal(
    (
      await request(app)
        .post('/action')
        .send({ action: 'ack', keys: ['a'] })
    ).status,
    404
  );

  const ack = await request(app)
    .post('/action')
    .send({ endpoint: ENDPOINT, action: 'ack', keys: ['services/n1:a', 'services/n1:gone'] });
  assert.equal(ack.status, 200);
  assert.deepEqual(ack.body, {
    ok: true,
    applied: ['services/n1:a'],
    ignored: ['services/n1:gone'],
  });
  assert.equal(state.suppression('services/n1:a', false), 'ack');
  assert.equal(saves(), 1, 'persisted');

  const snooze = await request(app)
    .post('/action')
    .send({ endpoint: ENDPOINT, action: 'snooze', keys: ['services/n1:b'], minutes: 60 });
  assert.equal(snooze.status, 200);
  assert.equal(state.suppression('services/n1:b', false), 'snooze');
  assert.equal(saves(), 2);
});

test('the action route refuses bad bodies and a flood', async () => {
  const { app, clock } = setup();
  const post = (body) =>
    request(app)
      .post('/action')
      .send({ endpoint: ENDPOINT, ...body });
  assert.equal((await post({ action: 'wipe', keys: ['a'] })).status, 400);
  assert.equal((await post({ action: 'ack', keys: [] })).status, 400);
  assert.equal((await post({ action: 'ack', keys: [5] })).status, 400);
  assert.equal(
    (await post({ action: 'ack', keys: Array.from({ length: 51 }, (_, i) => `k${i}`) })).status,
    400
  );
  assert.equal((await post({ action: 'snooze', keys: ['a'], minutes: 5000 })).status, 400);
  // Valid requests are never counted.
  for (let i = 0; i < 70; i += 1) assert.equal((await post({ action: 'ack', keys: ['a'] })).status, 200);
  // Junk from one address is, and then that address waits, a minute.
  const junk = (n) => request(app).post('/action').send({ endpoint: `${ENDPOINT}x${n}`, action: 'ack', keys: ['a'] });
  for (let i = 0; i < 60; i += 1) assert.equal((await junk(i)).status, 404);
  const flood = await junk(61);
  assert.equal(flood.status, 429);
  assert.equal(flood.headers['retry-after'], '60');
  clock.now += 61_000;
  assert.equal((await post({ action: 'ack', keys: ['a'] })).status, 200);
});

test('Settings lists what is snoozed and acked, and can lift it', async () => {
  const { app, state } = setup();
  state.observe('nodes/pve', false);
  state.ack(['nodes/pve']);
  state.snooze(['services/n1:a'], 3_600_000);
  const view = await request(app).get('/alerts');
  assert.equal(view.status, 200);
  assert.equal(view.headers['cache-control'], 'no-store');
  assert.equal(view.body.held, 0);
  // The zone quiet hours use until one is chosen (#703) is on the list the picker offers.
  const { validTimezone } = await import('../push/alertRules.js');
  assert.equal(validTimezone(view.body.serverTimezone), true);
  assert.deepEqual(
    view.body.acked.map((a) => a.tag),
    ['nodes/pve']
  );
  assert.deepEqual(
    view.body.snoozed.map((a) => a.tag),
    ['services/n1:a']
  );
  assert.deepEqual((await request(app).post('/alerts/clear').send({ tag: 'nodes/pve' })).body, {
    cleared: true,
  });
  assert.deepEqual((await request(app).get('/alerts')).body.acked, []);
  assert.equal((await request(app).post('/alerts/clear').send({})).status, 400);
});

test('the alert history carries the known cause of a matching event, by the rules now in force', async () => {
  const history = {
    events: () => ({
      events: [
        {
          id: '2',
          type: 'service_down',
          entity: 'services/pi:omada',
          body: 'Omada Controller on pi · down',
          reason: 'down',
        },
        {
          id: '1',
          type: 'service_down',
          entity: 'services/vm:gitea',
          body: 'Gitea on vm · down',
          reason: 'down',
        },
      ],
      next: null,
    }),
  };
  let causes = [{ match: 'omada', label: 'AP reboot' }];
  const app = express();
  app.use('/events', createEventsRoutes({ history, causes: () => causes }));
  let body = (await request(app).get('/events')).body;
  assert.equal(body.events[0].cause, 'AP reboot');
  assert.equal('cause' in body.events[1], false);
  causes = [];
  body = (await request(app).get('/events')).body;
  assert.equal('cause' in body.events[0], false);
});
