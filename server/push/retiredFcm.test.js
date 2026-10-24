/**
 * The Android app's device records, retired with the Firebase sender (#659):
 * what a data directory that held both kinds does on the first boot after, to
 * the registry file, the phones list and the outbox.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

import { createPushRoutes } from '../routes/push.js';
import { createChannels } from './channels.js';
import { createPushSnapshot, TEST_PUSH } from './dispatch.js';
import { createPushSender } from './outbox.js';
import { deviceIdOf } from './prefs.js';
import { dropRetiredFcmRecords } from './retiredFcm.js';
import { createWebPushStore } from './webPushStore.js';
import { generateVapidKeys } from './webPushCrypto.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const recorder = () => {
  const lines = [];
  const at = (level) => (fields, msg) => lines.push({ level, fields, msg });
  return { lines, info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') };
};

const tmp = () => mkdtempSync(join(tmpdir(), 'jh-retired-fcm-'));
const subscription = (name) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}-ENDPOINT-SECRET`,
  p256dh: generateVapidKeys().publicKey,
  auth: randomBytes(16).toString('base64url'),
  name,
});

// An FCM token record as the app's registration left it (push/tokenStore.js, #320), and a token's secret.
const FCM_TOKEN_A = 'dGVzdC10b2tlbi1waXhlbDo5MXNlY3JldA'; // pragma: allowlist secret
const FCM_TOKEN_B = 'dGVzdC10b2tlbi10YWJsZXQ6c2VjcmV0'; // pragma: allowlist secret
const fcmRecord = (model) => ({
  platform: 'android',
  appVersion: '1.3.0',
  model,
  os: '15',
  registeredAt: 1_000,
  lastSeenAt: 2_000,
  lastDeliveredAt: 3_000,
  prefs: { categories: { service: true, host: true, ups: true, cron: true, watchtower: true }, notifyRecoveries: true, enabled: true },
});

/** A registry file that holds both kinds: two FCM tokens and the web subscription Jag's phone made. */
function bothKinds(dir) {
  const web = createWebPushStore({ path: join(dir, 'push-subscriptions.json'), now: () => 5_000 });
  const added = web.register(subscription('jag-pwa'));
  assert.equal(added.ok, true);
  const webRecord = JSON.parse(readFileSync(join(dir, 'push-subscriptions.json'), 'utf8'))[added.id];
  const registry = join(dir, 'push-tokens.json');
  writeFileSync(
    registry,
    JSON.stringify({ [FCM_TOKEN_A]: fcmRecord('Pixel 8'), [added.id]: webRecord, [FCM_TOKEN_B]: fcmRecord('Tab S9') }, null, 2)
  );
  return { registry, web, webId: added.id, webRecord };
}

test('fcm records are dropped on load: one info line, the web record byte for byte, the file rewritten atomically (0600)', () => {
  const dir = tmp();
  try {
    const { registry, webId, webRecord } = bothKinds(dir);
    const log = recorder();
    assert.equal(dropRetiredFcmRecords({ path: registry, logger: log }), 2);

    const after = JSON.parse(readFileSync(registry, 'utf8'));
    assert.deepEqual(Object.keys(after), [webId]);
    assert.equal(JSON.stringify(after[webId]), JSON.stringify(webRecord), 'the web subscription is untouched');
    assert.equal(readFileSync(registry, 'utf8'), JSON.stringify({ [webId]: webRecord }, null, 2), 'written as the stores write');
    assert.equal(statSync(registry).mode & 0o777, 0o600);

    assert.deepEqual(log.lines.map((l) => l.level), ['info'], 'one line, no warn or error');
    assert.deepEqual(log.lines[0].fields, { dropped: 2 });
    const said = JSON.stringify(log.lines);
    for (const secret of [FCM_TOKEN_A, FCM_TOKEN_B, webRecord.endpoint, webRecord.p256dh, webRecord.auth]) {
      assert.ok(!said.includes(secret), 'no token, endpoint or key in the log');
    }

    // The next boot finds nothing to do and says nothing.
    const again = recorder();
    const text = readFileSync(registry, 'utf8');
    assert.equal(dropRetiredFcmRecords({ path: registry, logger: again }), 0);
    assert.deepEqual(again.lines, []);
    assert.equal(readFileSync(registry, 'utf8'), text, 'not rewritten');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a registry of only FCM tokens becomes empty; a missing, damaged or foreign file is left alone and quiet', () => {
  const dir = tmp();
  try {
    const only = join(dir, 'only.json');
    writeFileSync(only, JSON.stringify({ [FCM_TOKEN_A]: fcmRecord('Pixel 8') }));
    assert.equal(dropRetiredFcmRecords({ path: only, logger: silent }), 1);
    assert.equal(readFileSync(only, 'utf8'), '{}');

    for (const [name, text] of [['damaged.json', '{"half'], ['array.json', '[1,2]'], ['empty.json', '{}']]) {
      const path = join(dir, name);
      writeFileSync(path, text);
      const log = recorder();
      assert.equal(dropRetiredFcmRecords({ path, logger: log }), 0, name);
      assert.equal(readFileSync(path, 'utf8'), text, `${name} untouched`);
      assert.deepEqual(log.lines, [], `${name}: nothing said`);
    }
    const none = recorder();
    assert.equal(dropRetiredFcmRecords({ path: join(dir, 'missing.json'), logger: none }), 0);
    assert.deepEqual(none.lines, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file that cannot be written is one warn line, no throw, nothing lost, and push carries on', () => {
  const dir = tmp();
  try {
    const { registry } = bothKinds(dir);
    const before = readFileSync(registry, 'utf8');
    chmodSync(dir, 0o500); // the directory takes no new file: the atomic write fails
    const log = recorder();
    try {
      assert.equal(dropRetiredFcmRecords({ path: registry, logger: log }), 0);
    } finally {
      chmodSync(dir, 0o700);
    }
    assert.deepEqual(log.lines.map((l) => l.level), ['warn']);
    assert.deepEqual(Object.keys(log.lines[0].fields), ['code']);
    assert.equal(readFileSync(registry, 'utf8'), before, 'the file is as it was');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Settings → Notifications lists only the web devices after the drop, and does not know the app’s ids', async () => {
  const dir = tmp();
  try {
    const { registry, web, webId } = bothKinds(dir);
    dropRetiredFcmRecords({ path: registry, logger: silent });
    const channels = createChannels(() => ({ isEnabled: () => true, sendToToken: async () => ({ ok: true, prune: false }) }));
    const app = express();
    app.use(express.json());
    app.use('/api/push', createPushRoutes({ store: web, channels }));

    const list = await request(app).get('/api/push/devices');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.devices.map((d) => [d.id, d.platform, d.name]), [[webId, 'web', 'jag-pwa']]);
    assert.deepEqual(list.body.channels, { web: true });
    assert.ok(!JSON.stringify(list.body).includes('Pixel'), 'the app’s phones are not listed');
    assert.equal((await request(app).delete(`/api/push/devices/${deviceIdOf(FCM_TOKEN_A)}`)).status, 404);
    assert.equal((await request(app).get('/api/push/devices')).body.devices.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a persisted outbox with a push addressed to an FCM device is dropped cleanly on boot: nothing sent for it, no error, the web phone still gets the rest', async () => {
  const dir = tmp();
  try {
    const web = createWebPushStore({ path: join(dir, 'push-subscriptions.json') });
    const added = web.register(subscription('jag-pwa'));
    const webToken = `wp:${added.id}`;
    const fcmDevice = deviceIdOf(FCM_TOKEN_A);
    const path = join(dir, 'push-snapshot.json');
    const page = { type: 'service_down', id: 'apps:jellyfin', node: 'apps', severity: 'critical', title: 'Service down', body: 'Jellyfin on apps · Kuma reports it down' };
    const toTheApp = { type: TEST_PUSH, id: fcmDevice, node: 'JagHelm', severity: 'info', title: 'JagHelm test push', body: 'Sent from Settings', device: fcmDevice };
    writeFileSync(
      path,
      JSON.stringify({
        services: {},
        outbox: [
          { queuedAt: 1_000, event: toTheApp },
          { queuedAt: 2_000, event: page },
        ],
      })
    );

    const log = recorder();
    const snapshot = createPushSnapshot({ path, logger: log });
    assert.equal(snapshot.outbox().length, 2, 'both loaded from the file');

    const sent = [];
    const channels = createChannels(() => ({
      isEnabled: () => true,
      sendToToken: async (token, event) => {
        sent.push([token, event.type, event.id]);
        return { ok: true, prune: false };
      },
    }));
    const sender = createPushSender({ outbox: snapshot, store: web, channels, logger: log, sleep: async () => {} });
    sender.wake();
    await sender.idle();

    assert.deepEqual(sent, [[webToken, 'service_down', 'apps:jellyfin']], 'only the page, only to the web phone');
    assert.deepEqual(snapshot.outbox(), [], 'the outbox is empty: the app’s push is dropped, not stuck');
    assert.deepEqual(log.lines.filter((l) => l.level === 'warn' || l.level === 'error'), []);
    assert.equal(sender.stalled(), null);
    assert.equal(web.getDevices()[0].lastError, undefined, 'the web phone has no failure');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
